import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AsaasWebhookPayload } from '../types/asaas';

export const handleAsaasWebhook = async (req: Request, res: Response) => {
  try {
    const token = req.header('asaas-access-token');
    if (!token || token !== process.env.ASAAS_WEBHOOK_TOKEN) {
      return res.status(401).json({ error: 'Invalid webhook token' });
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

    // TODO: processamento assíncrono — ler a linha inserida, atualizar
    // `payments` (status, payment_date, net_value) via asaas_payment_id, e
    // então marcar asaas_webhook_logs.processed = true. Precisa responder 200
    // rápido (Asaas expira/reenvia), então isso deve rodar fora desta request.

    return res.status(200).json({ received: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
