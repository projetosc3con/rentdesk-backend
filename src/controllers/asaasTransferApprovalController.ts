import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AsaasWithdrawValidationPayload } from '../types/asaas';

// Mecanismo de validação de saque (Integrações > Mecanismos de Segurança no
// painel Asaas) — endpoint SEPARADO do webhook normal (/api/webhooks/asaas),
// com contrato diferente: o Asaas espera uma resposta síncrona em poucos
// segundos ({status: 'APPROVED'|'REFUSED'}), não um 200 genérico. Depois de 3
// falhas (timeout, erro, status inválido) a operação é recusada
// automaticamente pelo próprio Asaas.
//
// Critério de aprovação: só aprova transferências que o próprio RentDesk
// pediu (bills.asaas_transfer_id bate com o id recebido) — qualquer coisa
// não reconhecida é recusada por padrão. Isso cobre tanto o caso normal
// (repasse automático via createBillFromPayment) quanto uma eventual
// tentativa de transferência não iniciada por este backend.
export const handleAsaasTransferApproval = async (req: Request, res: Response) => {
  const token = req.header('asaas-access-token');
  if (!token || token !== process.env.ASAAS_TRANSFER_APPROVAL_TOKEN) {
    return res.status(403).json({ error: 'Invalid webhook token' });
  }

  try {
    const payload = req.body as AsaasWithdrawValidationPayload;

    // Só sabemos avaliar pedidos do tipo TRANSFER (repasse via Pix, ver
    // asaasWebhookController.requestTransfer) — qualquer outro tipo
    // (BILL/PIX_QR_CODE/MOBILE_PHONE_RECHARGE/PIX_REFUND) não é iniciado por
    // este backend hoje, então é recusado por segurança.
    if (payload.type !== 'TRANSFER' || !payload.transfer?.id) {
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Tipo de operação não reconhecido pelo RentDesk' });
    }

    const { data: bill } = await supabaseAdmin
      .from('bills')
      .select('id')
      .eq('asaas_transfer_id', payload.transfer.id)
      .maybeSingle();

    if (!bill) {
      console.warn(`[handleAsaasTransferApproval] Transferência ${payload.transfer.id} não corresponde a nenhum bill local — recusando`);
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Transferência não reconhecida pelo RentDesk' });
    }

    return res.status(200).json({ status: 'APPROVED' });
  } catch (error: any) {
    // Erro interno também vira REFUSED (nunca deixa a operação "pendurada"
    // sem resposta) — o Asaas trata timeout/erro como recusa de qualquer
    // forma, então ser explícito aqui só ajuda a diagnosticar depois.
    console.error('[handleAsaasTransferApproval] Erro ao validar:', error.message);
    return res.status(200).json({ status: 'REFUSED', refuseReason: 'Erro interno ao validar' });
  }
};
