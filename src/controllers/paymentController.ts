import { Response } from 'express';
import { getSupabaseUserClient } from '../config/supabase';
import { asaasService } from '../services/asaasService';
import { AsaasChargeRequest, AsaasBillingType } from '../types/asaas';
import { AuthRequest } from '../middleware/auth';

export const createChargeForInvoice = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);

    // Sem invoice_items — total_value já vem pronto da raiz do rental_invoice.
    const { data: invoice, error: invoiceError } = await supabase
      .from('rental_invoices')
      .select('*')
      .eq('id', id)
      .single();
    if (invoiceError || !invoice) {
      return res.status(404).json({ error: 'Fatura não encontrada' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('asaas_customer_id')
      .eq('id', invoice.client_id)
      .single();
    if (!client?.asaas_customer_id) {
      return res.status(400).json({ error: 'Cliente sem cadastro Asaas (asaas_customer_id)' });
    }

    const { data: settings } = await supabase
      .from('erp_company_settings')
      .select('asaas_api_key')
      .eq('active', true)
      .single();
    if (!settings?.asaas_api_key) {
      return res.status(400).json({ error: 'Locadora sem chave Asaas configurada' });
    }

    // Cobrança de valor único — descrição vem da fatura/equipamento.
    const chargeData: AsaasChargeRequest = {
      customer: client.asaas_customer_id,
      billingType: (invoice.payment_method as AsaasBillingType) || 'UNDEFINED',
      value: invoice.total_value,
      dueDate: invoice.due_date,
      description: `Fatura ${invoice.invoice_number || invoice.id} - ${invoice.equipment_name}`,
      externalReference: invoice.id,
    };

    const charge = await asaasService.createCharge(settings.asaas_api_key, chargeData);

    await supabase
      .from('rental_invoices')
      .update({ billing_status: 'Faturado' })
      .eq('id', invoice.id);

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        invoice_id: invoice.id,
        client_id: invoice.client_id,
        asaas_payment_id: charge.id,
        billing_type: charge.billingType,
        value: charge.value,
        net_value: charge.netValue,
        due_date: charge.dueDate,
        payment_date: charge.paymentDate ?? null,
        status: charge.status,
        is_manual_reconciliation: false,
      })
      .select()
      .single();
    if (paymentError) throw paymentError;

    return res.status(201).json({ invoice_id: invoice.id, charge, payment });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
