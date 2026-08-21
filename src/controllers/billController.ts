import { Response } from 'express';
import { getSupabaseUserClient } from '../config/supabase';
import { AuthRequest } from '../middleware/auth';
import { BillStatementItem, CreateBillPayload } from '../types/bill';
import { normalizeBill, normalizePendingPayment } from '../utils/billNormalizers';

// TODO(SECURITY): a tabela `bills` foi criada sem RLS/policies (confirmado
// via introspecção do schema em 02/08/2026). Esta rota já usa o client
// escopado pelo token do usuário (getSupabaseUserClient), no mesmo padrão de
// listPayments — mas sem RLS habilitada no banco, esse escopo não filtra
// nada de fato: qualquer usuário autenticado (qualquer role que passe pelo
// middleware `authorize` abaixo) enxerga todas as linhas de `bills`, de
// qualquer cliente. Antes de considerar esse endpoint pronto pra produção:
//   1. Habilitar RLS em `bills` (`alter table bills enable row level security`).
//   2. Criar as policies adequadas (leitura por role/tenant, igual às demais
//      tabelas financeiras — conferir o padrão já usado em `payments`/
//      `rental_invoices` como referência).
//   3. Remover este comentário quando a policy estiver validada em produção.
//
// Extrato bancário: mescla `bills` (já lançado, automático via webhook
// Asaas ou manual) com `payments` ainda sem bill vinculado (cobrança Asaas
// em aberto — ver createBillFromPayment em asaasWebhookController.ts).
// Um payment só some daqui quando o bill correspondente é criado de fato
// (não quando payments.status muda pra RECEIVED), porque o pedido de
// repasse ao Asaas pode falhar entre as duas coisas — nesse caso o payment
// deve continuar aparecendo até o bill existir.
export const listBills = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { client_id, status, origin, from, to, type, unreconciled } = req.query;

    // Paginação só se aplica ao ramo "merge completo" abaixo (bills +
    // payments pendentes) — é a única consulta que vira uma tabela grande
    // sem fim. O ramo com filtros (picker de "vincular a lançamento
    // existente") continua devolvendo array puro, sem paginar.
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 20));

    let billsQuery = supabase
      .from('bills')
      .select('*, invoice:rental_invoices(invoice_number, client_name), client:clients(company_name, cnpj), payment:payments(invoice_url, bank_slip_url)')
      .order('created_at', { ascending: false });

    if (client_id) billsQuery = billsQuery.eq('client_id', client_id as string);
    if (status) billsQuery = billsQuery.eq('status', status as string);
    if (origin) billsQuery = billsQuery.eq('origin', origin as string);
    if (type) billsQuery = billsQuery.eq('type', type as string);
    if (from) billsQuery = billsQuery.gte('due_date', from as string);
    if (to) billsQuery = billsQuery.lte('due_date', to as string);
    if (unreconciled === 'true') billsQuery = billsQuery.is('bank_transaction_date', null);

    const { data: bills, error: billsError } = await billsQuery;
    if (billsError) throw billsError;

    const items: BillStatementItem[] = (bills ?? []).map(normalizeBill);

    // Inclui pagamentos Asaas pendentes de reconciliação caso o filtro permita (tipo receivable e origem ASAAS ou sem filtro)
    const shouldIncludePayments =
      unreconciled !== 'true' &&
      (!type || type === 'receivable') &&
      (!origin || origin === 'ASAAS');

    if (shouldIncludePayments) {
      const { data: reconciled, error: reconciledError } = await supabase
        .from('bills')
        .select('payment_id')
        .not('payment_id', 'is', null);
      if (reconciledError) throw reconciledError;

      const reconciledPaymentIds = new Set((reconciled ?? []).map((r) => r.payment_id));

      let paymentsQuery = supabase
        .from('payments')
        .select('*, invoice:rental_invoices(invoice_number, client_name)')
        .order('created_at', { ascending: false });

      if (client_id) paymentsQuery = paymentsQuery.eq('client_id', client_id as string);
      if (from) paymentsQuery = paymentsQuery.gte('due_date', from as string);
      if (to) paymentsQuery = paymentsQuery.lte('due_date', to as string);

      if (status) {
        if (status === 'Pendente') paymentsQuery = paymentsQuery.eq('status', 'PENDING');
        else if (status === 'Atrasado') paymentsQuery = paymentsQuery.eq('status', 'OVERDUE');
        else if (status === 'Recebido') paymentsQuery = paymentsQuery.eq('status', 'RECEIVED');
        else if (status === 'Aguardando compensação') paymentsQuery = paymentsQuery.eq('status', 'CONFIRMED');
        else paymentsQuery = paymentsQuery.eq('status', '__NONE__');
      }

      const { data: payments, error: paymentsError } = await paymentsQuery;
      if (paymentsError) throw paymentsError;

      const pending = (payments ?? []).filter((p) => !reconciledPaymentIds.has(p.id));
      items.push(...pending.map(normalizePendingPayment));
    }

    items.sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return b.due_date.localeCompare(a.due_date);
    });

    // Se a rota foi chamada especificamente para o modal de conciliação (unreconciled === 'true'), retorna array simples
    if (unreconciled === 'true') {
      return res.json(items);
    }

    // Retorno paginado padrão para a tabela do extrato
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const paginated = items.slice(start, start + limit);

    return res.json({ data: paginated, total, page, limit, totalPages });
  } catch (error: any) {
    console.error('[listBills] Erro:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

// Lançamento manual de conta a pagar/receber. `bills.status` tem um CHECK
// constraint no banco que só aceita os 5 valores usados pro lado de
// recebível (Pendente/Atrasado/Recebido/Divergente/No prazo) — confirmado
// empiricamente tentando inserir 'Pago' (erro 23514). Por isso um lançamento
// de conta a pagar já quitada também usa status='Recebido', mesmo não sendo
// o nome ideal — mudar isso exigiria alterar o constraint no banco.
export const createBill = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const {
      type, counterparty_name, description, barcode,
      gross_value, due_date, already_settled, settled_date,
      bank_transaction_date, bank_raw_snapshot,
    } = req.body as CreateBillPayload;

    if (type !== 'receivable' && type !== 'payable') {
      return res.status(400).json({ error: "type deve ser 'receivable' ou 'payable'" });
    }
    if (!gross_value || gross_value <= 0) {
      return res.status(400).json({ error: 'gross_value é obrigatório e deve ser maior que zero' });
    }
    if (!due_date) {
      return res.status(400).json({ error: 'due_date é obrigatório' });
    }
    if (already_settled && !settled_date) {
      return res.status(400).json({ error: 'settled_date é obrigatório quando already_settled=true' });
    }

    // Lançamento manual não vincula a um cliente cadastrado — apenas um
    // nome livre (counterparty_name), tanto pra conta a pagar (fornecedor)
    // quanto a receber (quem vai pagar).
    const { data, error } = await supabase
      .from('bills')
      .insert({
        origin: 'MANUAL',
        type,
        client_id: null,
        counterparty_name: counterparty_name || null,
        description: description || null,
        gross_value,
        fee_amount: 0,
        net_value: gross_value,
        due_date,
        status: already_settled ? 'Recebido' : 'Pendente',
        reconciled_at: already_settled ? new Date(settled_date as string).toISOString() : null,
        bank_transaction_date: bank_transaction_date || null,
        bank_raw_snapshot: bank_raw_snapshot || null,
        // Coluna `barcode` só existe depois da migração
        // `ALTER TABLE bills ADD COLUMN barcode text;` — incluída apenas
        // quando informada pra não quebrar lançamentos sem código de barras
        // caso a migração ainda não tenha rodado.
        ...(barcode ? { barcode } : {}),
      })
      .select('*, invoice:rental_invoices(invoice_number, client_name), client:clients(company_name, cnpj)')
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (error: any) {
    console.error('[createBill] Erro:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
