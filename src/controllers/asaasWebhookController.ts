import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AsaasWebhookPayload } from '../types/asaas';

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
    .select('id')
    .eq('asaas_payment_id', payload.payment.id)
    .maybeSingle();

  if (!payment) {
    console.warn(`[handleAsaasWebhook] Nenhum payment local para asaas_payment_id=${payload.payment.id}`);
    return;
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
      net_value: payload.payment.netValue ?? null,
    })
    .eq('id', payment.id);
  if (paymentError) throw paymentError;

  const { error: logError } = await supabaseAdmin
    .from('asaas_webhook_logs')
    .update({ processed: true })
    .eq('event_id', payload.id);
  if (logError) throw logError;
}
