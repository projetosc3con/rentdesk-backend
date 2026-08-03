import { Response } from 'express';
import { getSupabaseUserClient } from '../config/supabase';
import { AuthRequest } from '../middleware/auth';
import { CreateBillPayload } from '../types/bill';

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
export const listBills = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { client_id, status, origin, from, to } = req.query;

    let query = supabase
      .from('bills')
      .select('*, invoice:rental_invoices(invoice_number, client_name), client:clients(company_name, cnpj)')
      .order('created_at', { ascending: false });

    if (client_id) query = query.eq('client_id', client_id as string);
    if (status) query = query.eq('status', status as string);
    if (origin) query = query.eq('origin', origin as string);
    if (from) query = query.gte('due_date', from as string);
    if (to) query = query.lte('due_date', to as string);

    const { data, error } = await query;
    if (error) throw error;

    return res.json(data);
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
