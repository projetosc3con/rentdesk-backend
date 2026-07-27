import { Response } from 'express';
import { getSupabaseUserClient } from '../config/supabase';
import { asaasService } from '../services/asaasService';
import { AsaasChargeRequest, AsaasBillingType, AsaasSubaccountRequest } from '../types/asaas';
import { AuthRequest } from '../middleware/auth';

const REQUIRED_SUBACCOUNT_FIELDS: (keyof AsaasSubaccountRequest)[] = [
  'name', 'email', 'cpfCnpj', 'mobilePhone', 'address', 'addressNumber', 'province', 'postalCode', 'incomeValue',
];

export const setupSubaccount = async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as AsaasSubaccountRequest;
    const missing = REQUIRED_SUBACCOUNT_FIELDS.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
    if (missing.length > 0) {
      return res.status(400).json({ error: `Campos obrigatórios ausentes: ${missing.join(', ')}` });
    }

    const subaccount = await asaasService.createSubaccount(body);

    const supabase = getSupabaseUserClient(req.token!);
    const { data: existingSettings } = await supabase
      .from('erp_company_settings')
      .select('id')
      .eq('active', true)
      .single();

    const settingsPayload = {
      company_name: body.name,
      cnpj: body.cpfCnpj,
      asaas_api_key: subaccount.apiKey,
      active: true,
    };

    const { data: settings, error: settingsError } = existingSettings
      ? await supabase
          .from('erp_company_settings')
          .update(settingsPayload)
          .eq('id', existingSettings.id)
          .select()
          .single()
      : await supabase
          .from('erp_company_settings')
          .insert(settingsPayload)
          .select()
          .single();
    if (settingsError) throw settingsError;

    return res.status(201).json({ subaccount, settings });
  } catch (error: any) {
    console.error('[setupSubaccount] Erro:', error.response?.data || error.message);
    return res.status(500).json({ error: error.message, asaas: error.response?.data });
  }
};

// Debug: confirma server-side (sem copy/paste manual) que a chave salva em
// erp_company_settings.asaas_api_key é válida no Asaas.
export const verifySubaccount = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data: settings } = await supabase
      .from('erp_company_settings')
      .select('asaas_api_key')
      .eq('active', true)
      .single();
    if (!settings?.asaas_api_key) {
      return res.status(400).json({ error: 'Locadora sem chave Asaas configurada' });
    }

    const account = await asaasService.getMyAccount(settings.asaas_api_key);
    return res.json({
      keyPreview: `${settings.asaas_api_key.slice(0, 12)}...${settings.asaas_api_key.slice(-4)} (${settings.asaas_api_key.length} chars)`,
      account,
    });
  } catch (error: any) {
    console.error('[verifySubaccount] Erro:', error.response?.data || error.message);
    return res.status(500).json({ error: error.message, asaas: error.response?.data });
  }
};

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
    console.error('[createChargeForInvoice] Erro:', error.response?.data || error.message);
    return res.status(500).json({ error: error.message, asaas: error.response?.data });
  }
};

// Status de pagamento de uma fatura específica — pode haver mais de um
// registro em `payments` por fatura (ex: reemissão de cobrança).
export const getInvoicePayments = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('invoice_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return res.json(data);
  } catch (error: any) {
    console.error('[getInvoicePayments] Erro:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

// Extrato geral de pagamentos, com filtros opcionais via query string.
export const listPayments = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { client_id, status, from, to } = req.query;

    let query = supabase
      .from('payments')
      .select('*, invoice:rental_invoices(invoice_number, client_name)')
      .order('created_at', { ascending: false });

    if (client_id) query = query.eq('client_id', client_id as string);
    if (status) query = query.eq('status', status as string);
    if (from) query = query.gte('due_date', from as string);
    if (to) query = query.lte('due_date', to as string);

    const { data, error } = await query;
    if (error) throw error;

    return res.json(data);
  } catch (error: any) {
    console.error('[listPayments] Erro:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
