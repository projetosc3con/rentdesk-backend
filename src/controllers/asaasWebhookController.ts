import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AsaasWebhookPayload } from '../types/asaas';
import { bbPixService } from '../services/bbPixService';
import { emitNfseCore } from './fiscalController';
import { emailService } from '../services/emailService';

const FAILED_NFSE_STATUSES = ['ERRO', 'ERROR'];

const PAID_EVENTS = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'];

export const handleAsaasWebhook = async (req: Request, res: Response) => {
  try {
    const token = req.header('asaas-access-token');
    if (!token || token !== process.env.ASAAS_WEBHOOK_TOKEN) {
      return res.status(403).json({ error: 'Invalid webhook token' });
    }

    const payload = req.body as AsaasWebhookPayload;

    // payment_id é NOT NULL na tabela — eventos de nota fiscal (INVOICE_*)
    // não trazem `payment`, só `invoice`, então cai no id do invoice; sem
    // nenhum dos dois (não deveria acontecer), cai no id do próprio evento
    // pra nunca violar a constraint.
    const { error } = await supabaseAdmin.from('asaas_webhook_logs').insert({
      event_id: payload.id,
      event_type: payload.event,
      payment_id: payload.payment?.id ?? payload.invoice?.id ?? payload.id,
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
    } else if (payload.event?.startsWith('INVOICE_') && payload.invoice?.id) {
      try {
        await handleInvoiceEvent(payload);
        await supabaseAdmin.from('asaas_webhook_logs').update({ processed: true }).eq('event_id', payload.id);
      } catch (processingError: any) {
        console.error('[handleAsaasWebhook] Erro ao processar evento de nota fiscal:', processingError.message);
      }
    }

    return res.status(200).json({ received: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// Eventos de nota fiscal (INVOICE_CREATED/UPDATED/SYNCHRONIZED/AUTHORIZED/
// PROCESSING_CANCELLATION/CANCELED) — sincroniza o status/link da nota local
// com o real do Asaas, e dispara o e-mail pro cliente exatamente no momento
// em que a prefeitura autoriza (é só nesse momento que o pdfUrl existe de
// fato; ver comentário em emitNfseAndNotifyClient sobre a emissão em si não
// ter o link ainda).
async function handleInvoiceEvent(payload: AsaasWebhookPayload) {
  const invoice = payload.invoice!;

  const { data: existing } = await supabaseAdmin
    .from('invoice_nfse')
    .select('id, invoice_id, status')
    .eq('external_id', invoice.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    console.warn(`[handleInvoiceEvent] Nenhuma NFS-e local para external_id=${invoice.id} (evento ${payload.event})`);
    return;
  }

  const wasAlreadyAuthorized = existing.status === 'AUTHORIZED';

  const { error: updateError } = await supabaseAdmin
    .from('invoice_nfse')
    .update({
      status: invoice.status,
      nfse_link: invoice.pdfUrl || null,
      xml_url: invoice.xmlUrl || null,
      return_message: invoice.errors?.map((e) => e.description).join('; ') || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);
  if (updateError) throw updateError;

  // Só manda e-mail na transição pra AUTHORIZED (não a cada reentrega do
  // mesmo evento, que o Asaas pode fazer).
  const justAuthorized = invoice.status === 'AUTHORIZED' && !wasAlreadyAuthorized;
  if (justAuthorized && invoice.pdfUrl) {
    await sendNfseEmailForInvoice(existing.invoice_id, invoice.pdfUrl);
  }
}

async function markPaymentAsPaid(payload: AsaasWebhookPayload) {
  const paymentPayload = payload.payment!;

  const { data: payment } = await supabaseAdmin
    .from('payments')
    .select('id, invoice_id, client_id, due_date, net_value_projected')
    .eq('asaas_payment_id', paymentPayload.id)
    .maybeSingle();

  if (!payment) {
    console.warn(`[handleAsaasWebhook] Nenhum payment local para asaas_payment_id=${paymentPayload.id}`);
    return;
  }

  // Conciliação: net_value_projected foi calculado na criação da cobrança
  // (gross-up com a taxa configurada em erp_company_settings). Se o net_value
  // real do pagamento divergir, a taxa configurada provavelmente ficou
  // desatualizada — só loga, não bloqueia a baixa do pagamento.
  const realNetValue = paymentPayload.netValue ?? null;
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
      status: paymentPayload.status,
      payment_date: paymentPayload.paymentDate ?? null,
      net_value: realNetValue,
    })
    .eq('id', payment.id);
  if (paymentError) throw paymentError;

  await createBillAndTransferPix(payment, payload, realNetValue);
  await emitNfseAndNotifyClient(payment);

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

  const paymentPayload = payload.payment!;
  const netValue = realNetValue ?? paymentPayload.netValue ?? paymentPayload.value;

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
    gross_value: paymentPayload.value,
    net_value: netValue,
    fee_amount: paymentPayload.value - netValue,
    due_date: payment.due_date,
    pix_end_to_end_id: transfer.endToEndId,
    bank_transaction_date: transfer.transferDate,
    bank_raw_snapshot: transfer.raw,
    status: 'Recebido',
    reconciled_at: new Date().toISOString(),
  });
  if (billError) throw billError;
}

// Emite a NFS-e automaticamente quando o pagamento é confirmado (pedido do
// Victor: "coloca isso naquele endpoint que recebe a confirmação de
// pagamento") e envia por e-mail pro cliente. Roda depois do repasse PIX,
// mesma lógica de idempotência da baixa acima: se já existe uma NFS-e não
// falha para esta fatura (emissão manual anterior, ou reentrega do mesmo
// evento), pula em vez de emitir de novo.
async function emitNfseAndNotifyClient(payment: { invoice_id: string; client_id: string }) {
  const { data: existingNfse } = await supabaseAdmin
    .from('invoice_nfse')
    .select('status')
    .eq('invoice_id', payment.invoice_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingNfse && !FAILED_NFSE_STATUSES.includes(existingNfse.status)) {
    console.log(`[emitNfseAndNotifyClient] NFS-e ja emitida (status=${existingNfse.status}) para invoice ${payment.invoice_id} - pulando`);
    return;
  }

  let nfse;
  try {
    ({ nfse } = await emitNfseCore(supabaseAdmin, payment.invoice_id));
  } catch (error: any) {
    // Mesmo tratamento de fallback do emitNfse (fiscalController.ts): registra
    // a falha em invoice_nfse pra aparecer no card "Nota Fiscal" da locação
    // (com o botão "Tentar Emitir Novamente"), em vez de só no log do webhook.
    await supabaseAdmin.from('invoice_nfse').insert({
      invoice_id: payment.invoice_id,
      gateway: 'asaas',
      status: 'ERRO',
      return_message: error.response?.data?.errors?.[0]?.description || error.message,
    });
    throw error;
  }

  // O link do PDF só fica disponível depois que a prefeitura autoriza a nota
  // (assíncrono) — na emissão o status normalmente ainda é SCHEDULED, sem
  // nfse_link. Sem worker/cron no projeto para reconsultar depois, o e-mail
  // só é disparado se o link já vier pronto; senão o cliente confere pela
  // tela (botão "Atualizar Status" em RentalEdit.tsx).
  if (!nfse.nfse_link) {
    console.log(`[emitNfseAndNotifyClient] NFS-e emitida (status=${nfse.status}) mas sem nfse_link ainda para invoice ${payment.invoice_id} - aguardando evento INVOICE_AUTHORIZED do webhook pra mandar o e-mail`);
    return;
  }

  await sendNfseEmailForInvoice(payment.invoice_id, nfse.nfse_link);
}

// Compartilhado entre a emissão síncrona (emitNfseAndNotifyClient, quando o
// pdfUrl já vem pronto na resposta de criação) e o evento assíncrono
// INVOICE_AUTHORIZED (handleInvoiceEvent, quando o link só fica disponível
// depois da autorização da prefeitura).
async function sendNfseEmailForInvoice(invoiceId: string, nfseLink: string) {
  const { data: invoice } = await supabaseAdmin
    .from('rental_invoices')
    .select('client_id, equipment_name, client_name')
    .eq('id', invoiceId)
    .single();
  if (!invoice) return;

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('email, company_name')
    .eq('id', invoice.client_id)
    .single();
  if (!client?.email) return;

  const { data: settings } = await supabaseAdmin
    .from('erp_company_settings')
    .select('company_name')
    .eq('active', true)
    .single();

  try {
    await emailService.sendNfseEmail({
      to: client.email,
      clientName: client.company_name || invoice.client_name || '',
      companyName: settings?.company_name || 'C3Loc',
      equipmentDescription: invoice.equipment_name || '',
      nfseLink,
    });
  } catch (emailError: any) {
    console.error('[sendNfseEmailForInvoice] Falha ao enviar e-mail de NFS-e:', emailError.response?.data || emailError.message);
  }
}
