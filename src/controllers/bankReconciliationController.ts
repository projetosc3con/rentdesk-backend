import { Response } from 'express';
import { getSupabaseUserClient } from '../config/supabase';
import { AuthRequest } from '../middleware/auth';
import { bbExtratoService } from '../services/bbExtratoService';
import { normalizeBill } from '../utils/billNormalizers';
import {
  BankStatementLine,
  BankStatementMatchResult,
  ReconcileBankStatementResponse,
} from '../types/bill';

const DEFAULT_PERIOD_DAYS = 30;
const VALUE_MATCH_TOLERANCE = 0.01;
const DATE_MATCH_TOLERANCE_DAYS = 5;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const diffMs = new Date(a).getTime() - new Date(b).getTime();
  return Math.abs(diffMs) / (1000 * 60 * 60 * 24);
}

function resolvePeriod(from: unknown, to: unknown): { from: string; to: string } {
  if (typeof from === 'string' && typeof to === 'string' && from && to) {
    return { from, to };
  }
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - DEFAULT_PERIOD_DAYS);
  return { from: toIsoDate(start), to: toIsoDate(today) };
}

// Aplica o dado de uma linha do extrato bancário sobre um bill existente —
// usado tanto no match automático (reconcileBankStatement) quanto no vínculo
// manual (linkStatementLineToBill). O bill passa a refletir exatamente o que
// está no banco (due_date/valor), além de ficar marcado como conciliado.
async function applyBankLineToBill(supabase: ReturnType<typeof getSupabaseUserClient>, billId: string, line: BankStatementLine) {
  const { data, error } = await supabase
    .from('bills')
    .update({
      due_date: line.bank_date,
      gross_value: line.value,
      net_value: line.value,
      bank_transaction_date: line.bank_date,
      bank_raw_snapshot: line.raw,
      status: 'Recebido',
      reconciled_at: new Date().toISOString(),
    })
    .eq('id', billId)
    .select('*, invoice:rental_invoices(invoice_number, client_name), client:clients(company_name, cnpj)')
    .single();
  if (error) throw error;
  return data;
}

// Concilia o extrato bancário do BB (por período, default últimos 30 dias)
// contra os `bills` ainda não conciliados (`bank_transaction_date IS NULL`).
// Match = mesmo tipo (D->payable, C->receivable) + valor dentro de
// VALUE_MATCH_TOLERANCE + due_date dentro de DATE_MATCH_TOLERANCE_DAYS.
// Cada bill só pode ser consumido por uma linha por execução. A tabela de
// extrato em si NÃO é persistida — só o resultado desta chamada (linhas +
// match) volta pro front, que guarda isso em estado local; os `bills`
// batidos são atualizados no banco via applyBankLineToBill.
export const reconcileBankStatement = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const period = resolvePeriod(req.query.from, req.query.to);

    const { simulated, lines } = await bbExtratoService.fetchExtrato(period);

    const candidateWindowStart = toIsoDate(new Date(new Date(period.from).getTime() - DATE_MATCH_TOLERANCE_DAYS * 86400000));
    const candidateWindowEnd = toIsoDate(new Date(new Date(period.to).getTime() + DATE_MATCH_TOLERANCE_DAYS * 86400000));

    const { data: candidates, error: candidatesError } = await supabase
      .from('bills')
      .select('*, invoice:rental_invoices(invoice_number, client_name), client:clients(company_name, cnpj)')
      .is('bank_transaction_date', null)
      .gte('due_date', candidateWindowStart)
      .lte('due_date', candidateWindowEnd);
    if (candidatesError) throw candidatesError;

    const availableCandidates = [...(candidates ?? [])];
    const results: BankStatementMatchResult[] = [];

    for (const line of lines) {
      const matchIndex = availableCandidates.findIndex((bill) =>
        bill.type === line.type &&
        bill.due_date != null &&
        daysBetween(bill.due_date, line.bank_date) <= DATE_MATCH_TOLERANCE_DAYS &&
        Math.abs(bill.net_value - line.value) <= VALUE_MATCH_TOLERANCE
      );

      if (matchIndex === -1) {
        results.push({ ...line, match_status: 'unmatched', matched_bill_id: null, matched_bill: null });
        continue;
      }

      const [candidate] = availableCandidates.splice(matchIndex, 1);
      const updatedBill = await applyBankLineToBill(supabase, candidate.id, line);
      results.push({
        ...line,
        match_status: 'matched',
        matched_bill_id: updatedBill.id,
        matched_bill: normalizeBill(updatedBill),
      });
    }

    const response: ReconcileBankStatementResponse = {
      period,
      simulated,
      lines: results,
      matched_count: results.filter((r) => r.match_status === 'matched').length,
      unmatched_count: results.filter((r) => r.match_status === 'unmatched').length,
    };

    return res.json(response);
  } catch (error: any) {
    console.error('[reconcileBankStatement] Erro:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

// Vincula manualmente uma linha do extrato (que não bateu automaticamente)
// a um bill já existente escolhido pelo usuário — o bill é atualizado pra
// bater com o extrato (mesma operação usada no match automático).
export const linkStatementLineToBill = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const id = req.params.id as string;
    const line = req.body as BankStatementLine;

    if (!line || !line.bank_date || typeof line.value !== 'number' || !line.dc_indicator || !line.type) {
      return res.status(400).json({ error: 'Linha do extrato inválida: bank_date, value, dc_indicator e type são obrigatórios' });
    }

    const updatedBill = await applyBankLineToBill(supabase, id, line);
    return res.json(updatedBill);
  } catch (error: any) {
    console.error('[linkStatementLineToBill] Erro:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
