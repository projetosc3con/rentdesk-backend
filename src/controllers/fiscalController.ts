import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getSupabaseUserClient, supabaseAdmin } from '../config/supabase';
import { asaasService } from '../services/asaasService';
import { AsaasInvoiceRequest } from '../types/asaas';

const TERMINAL_STATUSES = ['AUTHORIZED', 'CANCELLED', 'CANCELLATION_DENIED', 'ERROR'];

// Locação de bem móvel é operação de locação, não prestação de serviço —
// Súmula Vinculante 31 (STF) declara inconstitucional ISS sobre locação de
// bens móveis. Por padrão emitimos a NFS-e isenta (iss=0, retainIss=false);
// municípios que exigirem tributação normal podem sobrescrever via
// erp_company_settings.nfse_iss_regime = 'Tributado'.
export const emitNfse = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);

    const { data: invoice, error: invoiceError } = await supabase
      .from('rental_invoices')
      .select('*')
      .eq('id', id)
      .single();
    if (invoiceError || !invoice) {
      return res.status(404).json({ error: 'Fatura não encontrada' });
    }

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from('erp_company_settings')
      .select('asaas_api_key, nfse_service_code, nfse_iss_regime')
      .eq('active', true)
      .single();
    if (settingsError) {
      console.error('[emitNfse] Erro ao ler erp_company_settings:', settingsError);
    }
    if (!settings?.asaas_api_key) {
      return res.status(400).json({ error: 'Locadora sem chave Asaas configurada' });
    }

    // Nota fiscal é emitida em cima de uma cobrança já criada (fluxo:
    // fatura -> cobrança (payments) -> nota fiscal).
    const { data: payment } = await supabase
      .from('payments')
      .select('asaas_payment_id')
      .eq('invoice_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (!payment?.asaas_payment_id) {
      return res.status(400).json({ error: 'Fatura sem cobrança Asaas gerada. Crie a cobrança antes de emitir a nota fiscal.' });
    }

    const issRegime = settings.nfse_iss_regime || 'Isento';
    const invoiceData: AsaasInvoiceRequest = {
      payment: payment.asaas_payment_id,
      serviceDescription: `Locação de equipamento ${invoice.equipment_name || ''} - ${invoice.work_site || ''}`.trim(),
      observations: issRegime === 'Isento'
        ? 'Locação de bem móvel, sem prestação de serviços. Operação imune/isenta de ISS conforme Súmula Vinculante 31 do STF.'
        : undefined,
      value: invoice.total_value,
      effectiveDate: new Date().toISOString().slice(0, 10),
      municipalServiceCode: settings.nfse_service_code || undefined,
      taxes: {
        retainIss: false,
        iss: issRegime === 'Isento' ? 0 : undefined,
      },
    };

    const asaasInvoice = await asaasService.createInvoice(settings.asaas_api_key, invoiceData);

    const { data: nfse, error: nfseError } = await supabase
      .from('invoice_nfse')
      .insert({
        invoice_id: id,
        gateway: 'asaas',
        external_id: asaasInvoice.id,
        status: asaasInvoice.status,
        nfse_link: asaasInvoice.pdfUrl,
        xml_url: asaasInvoice.xmlUrl,
        service_code: settings.nfse_service_code,
        iss_regime: issRegime,
        return_message: asaasInvoice.errors?.map((e) => e.description).join('; ') || null,
      })
      .select()
      .single();
    if (nfseError) throw nfseError;

    return res.status(201).json({ invoice_id: id, nfse, asaas: asaasInvoice });
  } catch (error: any) {
    console.error('[emitNfse] Erro:', error.response?.data || error.message);

    // Best-effort: registra a falha no histórico mesmo sem sucesso no gateway,
    // para o status ficar visível sem depender só do log do servidor.
    try {
      const supabase = getSupabaseUserClient(req.token!);
      await supabase.from('invoice_nfse').insert({
        invoice_id: id,
        gateway: 'asaas',
        status: 'ERRO',
        return_message: error.response?.data?.errors?.[0]?.description || error.message,
      });
    } catch { /* não deixa o log de erro derrubar a resposta original */ }

    return res.status(500).json({ error: error.message, asaas: error.response?.data });
  }
};

export const getNfseStatus = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const supabase = getSupabaseUserClient(req.token!);

    const { data: nfse, error } = await supabase
      .from('invoice_nfse')
      .select('*')
      .eq('invoice_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (error || !nfse) {
      return res.status(404).json({ error: 'Nota fiscal ainda não emitida para esta fatura' });
    }

    // Se ainda não está em status terminal, consulta o gateway pra atualizar
    // (emissão de NFS-e é assíncrona na prefeitura).
    if (!TERMINAL_STATUSES.includes(nfse.status) && nfse.external_id) {
      const { data: settings } = await supabaseAdmin
        .from('erp_company_settings')
        .select('asaas_api_key')
        .eq('active', true)
        .single();

      if (settings?.asaas_api_key) {
        const fresh = await asaasService.getInvoice(settings.asaas_api_key, nfse.external_id);
        const { data: updated } = await supabase
          .from('invoice_nfse')
          .update({
            status: fresh.status,
            nfse_link: fresh.pdfUrl || nfse.nfse_link,
            xml_url: fresh.xmlUrl || nfse.xml_url,
            return_message: fresh.errors?.map((e) => e.description).join('; ') || nfse.return_message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', nfse.id)
          .select()
          .single();
        return res.json(updated);
      }
    }

    return res.json(nfse);
  } catch (error: any) {
    console.error('[getNfseStatus] Erro:', error.response?.data || error.message);
    return res.status(500).json({ error: error.message, asaas: error.response?.data });
  }
};
