import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AsaasWebhookPayload } from '../types/asaas';
import { bbPixService } from '../services/bbPixService';

const PAID_EVENTS = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'];

export const handleAsaasWebhook = async (req: Request, res: Response) => {
  try {
    const token = req.header('asaas-access-token');
    if (!token || token !== process.env.ASAAS_WEBHOOK_TOKEN) {
      return res.status(403).json({ error: 'Invalid webhook token' });
    }

    const payload = req.body as AsaasWebhookPayload;

    const { error } = await supabaseAdmin.from('asaas_webhook_logs').insert({
      event_id: payload.id,
      event_type: payload.event,
      payment_id: payload.payment?.id,
      payload: req.body,
      processed: false,
    });

    // Asaas reenvia entregas; event_id duplicado (unique, postgres 23505) é
    // esperado, não é erro — segue confirmando o recebimento.
    if (error && error.code !== '23505') throw error;

    // Processado de forma síncrona (sem fila/worker no projeto): os updates
    // abaixo são só 2-3 chamadas Supabase, bem dentro do timeout do Asaas.
    // Erro aqui não deve derrubar o 200 (senão o Asaas reentrega em loop) —
    // fica logado no console e a linha correspondente em asaas_webhook_logs
    // permanece com processed=false, sinalizando que precisa de atenção.
    if (PAID_EVENTS.includes(payload.event) && payload.payment?.id) {
      try {
        await markPaymentAsPaid(payload);
      } catch (processingError: any) {
        console.error('[handleAsaasWebhook] Erro ao processar baixa:', processingError.message);
      }
    }

    return res.status(200).json({ received: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

async function markPaymentAsPaid(payload: AsaasWebhookPayload) {
  const { data: payment } = await supabaseAdmin
    .from('payments')
    .select('id, invoice_id, client_id, due_date, net_value_projected')
    .eq('asaas_payment_id', payload.payment.id)
    .maybeSingle();

  if (!payment) {
    console.warn(`[handleAsaasWebhook] Nenhum payment local para asaas_payment_id=${payload.payment.id}`);
    return;
  }

  // Conciliação: net_value_projected foi calculado na criação da cobrança
  // (gross-up com a taxa configurada em erp_company_settings). Se o net_value
  // real do pagamento divergir, a taxa configurada provavelmente ficou
  // desatualizada — só loga, não bloqueia a baixa do pagamento.
  const realNetValue = payload.payment.netValue ?? null;
  if (payment.net_value_projected != null && realNetValue != null
      && Math.abs(realNetValue - payment.net_value_projected) >= 0.01) {
    console.warn(
      `[handleAsaasWebhook] net_value divergente no pagamento ${payment.id}: ` +
      `projetado=${payment.net_value_projected} real=${realNetValue} ` +
      `(verificar taxa em erp_company_settings)`
    );
  }

  // Status real do Asaas (ex: RECEIVED, CONFIRMED) — mesmo padrão já usado em
  // createChargeForInvoice (paymentController.ts), mantém granularidade em
  // vez de um valor fixo como 'PAID'.
  //
  // rental_invoices.billing_status NÃO é tocado aqui: é o enum
  // billing_status_type (Pendente/Faturado/Emitida/Cancelada), que hoje não
  // tem nenhum valor para "pago" — decisão do usuário foi não alterar esse
  // enum por ora. Quem precisa saber se uma fatura foi paga consulta
  // payments.status pelo invoice_id.
  const { error: paymentError } = await supabaseAdmin
    .from('payments')
    .update({
      status: payload.payment.status,
      payment_date: payload.payment.paymentDate ?? null,
      net_value: realNetValue,
    })
    .eq('id', payment.id);
  if (paymentError) throw paymentError;

  await createBillAndTransferPix(payment, payload, realNetValue);

  const { error: logError } = await supabaseAdmin
    .from('asaas_webhook_logs')
    .update({ processed: true })
    .eq('event_id', payload.id);
  if (logError) throw logError;
}

// Repasse do valor liquido pro BB + registro em bills ja conciliado. Roda
// depois da baixa em payments e antes de marcar o log como processed=true:
// se falhar aqui, o log fica com processed=false (sinaliza que precisa de
// atencao), em vez de esconder que o repasse/lancamento nao aconteceu.
//
// Idempotencia: PAID_EVENTS inclui PAYMENT_RECEIVED e PAYMENT_CONFIRMED - se o
// Asaas disparar os dois pro mesmo pagamento, o segundo evento nao pode gerar
// um novo PIX nem uma segunda linha em bills. Por isso o check por
// payment_id roda ANTES de chamar o BB, nao so antes do insert.
async function createBillAndTransferPix(
  payment: { id: string; invoice_id: string; client_id: string; due_date: string },
  payload: AsaasWebhookPayload,
  realNetValue: number | null
) {
  const { data: existingBill } = await supabaseAdmin
    .from('bills')
    .select('id')
    .eq('payment_id', payment.id)
    .maybeSingle();

  if (existingBill) {
    console.log(`[createBillAndTransferPix] bill ja existe para payment_id=${payment.id} (event ${payload.event} reenviado) - pulando`);
    return;
  }

  const netValue = realNetValue ?? payload.payment.netValue ?? payload.payment.value;

  const { data: settings } = await supabaseAdmin
    .from('erp_company_settings')
    .select('bank_code, bank_agency, bank_account, bank_pix_key')
    .eq('active', true)
    .single();

  const transfer = await bbPixService.transferNetValueToBB({
    paymentId: payment.id,
    value: netValue,
    destination: {
      bankCode: settings?.bank_code ?? null,
      agency: settings?.bank_agency ?? null,
      account: settings?.bank_account ?? null,
      pixKey: settings?.bank_pix_key ?? null,
    },
  });

  const { error: billError } = await supabaseAdmin.from('bills').insert({
    origin: 'ASAAS',
    type: 'receivable',
    rental_invoice_id: payment.invoice_id,
    payment_id: payment.id,
    client_id: payment.client_id,
    gross_value: payload.payment.value,
    net_value: netValue,
    fee_amount: payload.payment.value - netValue,
    due_date: payment.due_date,
    pix_end_to_end_id: transfer.endToEndId,
    bank_transaction_date: transfer.transferDate,
    bank_raw_snapshot: transfer.raw,
    status: 'Recebido',
    reconciled_at: new Date().toISOString(),
  });
  if (billError) throw billError;
}
