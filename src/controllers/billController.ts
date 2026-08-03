import { Response } from 'express';
import { getSupabaseUserClient } from '../config/supabase';
import { AuthRequest } from '../middleware/auth';
import { BillStatementItem, CreateBillPayload } from '../types/bill';

function normalizeBill(row: any): BillStatementItem {
  return {
    source: 'bill',
    id: row.id,
    type: row.type,
    status: row.status,
    origin: row.origin,
    gross_value: row.gross_value,
    net_value: row.net_value,
    fee_amount: row.fee_amount,
    due_date: row.due_date,
    settled_date: row.reconciled_at,
    client_id: row.client_id,
    client_name: row.client?.company_name ?? null,
    counterparty_name: row.counterparty_name,
    invoice_number: row.invoice?.invoice_number ?? null,
    description: row.description,
    invoice_url: row.payment?.invoice_url ?? null,
    bank_slip_url: row.payment?.bank_slip_url ?? null,
    raw: row,
  };
}

function normalizePendingPayment(row: any): BillStatementItem {
  return {
    source: 'payment',
    id: row.id,
    type: 'receivable',
    status: row.status,
    origin: null,
    gross_value: row.value,
    net_value: row.net_value,
    fee_amount: row.net_value != null ? row.value - row.net_value : null,
    due_date: row.due_date,
    settled_date: row.payment_date,
    client_id: row.client_id,
    client_name: row.invoice?.client_name ?? null,
    counterparty_name: null,
    invoice_number: row.invoice?.invoice_number ?? null,
    description: null,
    invoice_url: row.invoice_url ?? null,
    bank_slip_url: row.bank_slip_url ?? null,
    raw: row,
  };
}

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
// Extrato bancário: mescla `bills` (já conciliado, automático via webhook
// Asaas ou manual) com `payments` ainda sem bill vinculado (cobrança Asaas
// em aberto — ver createBillAndTransferPix em asaasWebhookController.ts).
// Um payment só some daqui quando o bill correspondente é criado de fato
// (não quando payments.status muda pra RECEIVED), porque o repasse BB pode
// falhar entre as duas coisas — nesse caso o payment deve continuar
// aparecendo até o bill existir.
export const listBills = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { client_id, status, origin, from, to } = req.query;

    let billsQuery = supabase
      .from('bills')
      .select('*, invoice:rental_invoices(invoice_number, client_name), client:clients(company_name, cnpj), payment:payments(invoice_url, bank_slip_url)')
      .order('created_at', { ascending: false });

    if (client_id) billsQuery = billsQuery.eq('client_id', client_id as string);
    if (status) billsQuery = billsQuery.eq('status', status as string);
    if (origin) billsQuery = billsQuery.eq('origin', origin as string);
    if (from) billsQuery = billsQuery.gte('due_date', from as string);
    if (to) billsQuery = billsQuery.lte('due_date', to as string);

    const { data: bills, error: billsError } = await billsQuery;
    if (billsError) throw billsError;

    const items: BillStatementItem[] = (bills ?? []).map(normalizeBill);

    // `origin`/`status` são específicos do vocabulário de `bills` e não têm
    // equivalente em `payments` — quando presentes, o usuário quer só a
    // visão de `bills`, então pulamos o bloco de payments pendentes.
    if (!origin && !status) {
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

    return res.json(items);
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
      type, client_id, counterparty_name, description,
      gross_value, due_date, already_settled, settled_date,
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
    if (type === 'receivable' && !client_id) {
      return res.status(400).json({ error: 'client_id é obrigatório para conta a receber' });
    }
    if (type === 'payable' && !counterparty_name) {
      return res.status(400).json({ error: 'counterparty_name é obrigatório para conta a pagar' });
    }
    if (already_settled && !settled_date) {
      return res.status(400).json({ error: 'settled_date é obrigatório quando already_settled=true' });
    }

    const { data, error } = await supabase
      .from('bills')
      .insert({
        origin: 'MANUAL',
        type,
        client_id: type === 'receivable' ? client_id : null,
        counterparty_name: type === 'payable' ? counterparty_name : null,
        description: description || null,
        gross_value,
        fee_amount: 0,
        net_value: gross_value,
        due_date,
        status: already_settled ? 'Recebido' : 'Pendente',
        reconciled_at: already_settled ? new Date(settled_date as string).toISOString() : null,
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
