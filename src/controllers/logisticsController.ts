import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getSupabaseUserClient } from '../config/supabase';

/**
 * GET /api/logistics/contracts
 * Returns all contracts with status in ['Assinado', 'Triagem', 'Processado']
 * enriched with deal + contract_form data for the logistics board.
 */
export const getAllContracts = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);

    const { data, error } = await supabase
      .from('crm_deal_contracts')
      .select(`
        *,
        deal:crm_deals!crm_deal_contracts_deal_id_fkey(
          id,
          title,
          value,
          client:clients(id, company_name, cnpj),
          lead:crm_leads(id, company_name)
        ),
        contract_form:crm_deal_contract_forms(
          equipment_description,
          equipment_model,
          work_site,
          locatario_company_name,
          locatario_cnpj,
          cost_total,
          period_start,
          period_end
        )
      `)
      .in('status', ['Assinado', 'Triagem', 'Processado'])
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    console.error('[logisticsController] Erro em getAllContracts:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
};

/**
 * GET /api/logistics/contracts/:id
 * Returns a single contract with full deal, contract_form and client data
 * for the triage page.
 */
export const getContractById = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { id } = req.params;

    const { data, error } = await supabase
      .from('crm_deal_contracts')
      .select(`
        *,
        deal:crm_deals!crm_deal_contracts_deal_id_fkey(
          id,
          title,
          value,
          expected_close_date,
          client_id,
          client:clients(id, company_name, cnpj, address_street, address_number, address_city, address_state),
          lead:crm_leads(id, company_name, cnpj)
        ),
        contract_form:crm_deal_contract_forms(*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Contrato não encontrado' });

    res.json(data);
  } catch (error: any) {
    console.error('[logisticsController] Erro em getContractById:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
};

/**
 * PATCH /api/logistics/contracts/:id/start-triage
 * Updates contract status from 'Assinado' to 'Triagem'.
 */
export const startTriage = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { id } = req.params;

    // Verify current status
    const { data: contract, error: fetchError } = await supabase
      .from('crm_deal_contracts')
      .select('status')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;
    if (!contract) return res.status(404).json({ error: 'Contrato não encontrado' });

    if (contract.status !== 'Assinado') {
      return res.status(400).json({ error: 'Apenas contratos com status "Assinado" podem iniciar triagem.' });
    }

    const { data, error } = await supabase
      .from('crm_deal_contracts')
      .update({
        status: 'Triagem',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    console.error('[logisticsController] Erro em startTriage:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
};

/**
 * PATCH /api/logistics/contracts/:id/finish
 * Updates contract status from 'Triagem' to 'Processado' and sets rental_invoice_id.
 */
export const finishProcessing = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { id } = req.params;
    const { equipment_id } = req.body;

    // Fetch contract with full relationship data
    const { data: contract, error: fetchError } = await supabase
      .from('crm_deal_contracts')
      .select(`
        *,
        deal:crm_deals!crm_deal_contracts_deal_id_fkey(
          id,
          title,
          client_id,
          client:clients(id, company_name, cnpj),
          lead:crm_leads(id, company_name, cnpj)
        ),
        contract_form:crm_deal_contract_forms(*)
      `)
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;
    if (!contract) return res.status(404).json({ error: 'Contrato não encontrado' });

    if (contract.status !== 'Triagem') {
      return res.status(400).json({ error: 'Apenas contratos em "Triagem" podem ser finalizados.' });
    }

    // Fetch details of selected equipment if equipment_id is provided
    let eqData: any = {};
    if (equipment_id) {
      const { data: eq, error: eqError } = await supabase
        .from('equipments')
        .select('name, type, asset_number')
        .eq('id', equipment_id)
        .single();
      if (!eqError && eq) {
        eqData = eq;
      }
    }

    const form = contract.contract_form || {};
    const deal = contract.deal || {};
    const client = deal.client || {};
    const lead = deal.lead || {};

    // 1. Create the rental invoice
    const invoicePayload = {
      client_id: client.id || deal.client_id || null,
      client_name: form.locatario_company_name || lead.company_name || client.company_name || 'N/A',
      cnpj: form.locatario_cnpj || lead.cnpj || client.cnpj || null,
      equipment_id: equipment_id || null,
      equipment_name: eqData.name || form.equipment_description || 'N/A',
      equipment_type: eqData.type || null,
      asset_number: eqData.asset_number || null,
      work_site: form.work_site || null,
      billing_period_start: form.period_start || null,
      billing_period_end: form.period_end || null,
      cost_rental: form.cost_rental || 0,
      cost_insurance: form.cost_insurance || 0,
      cost_freight: form.cost_freight || 0,
      cost_rcd: form.cost_rcd || 0,
      cost_third_party: form.cost_third_party || 0,
      cost_training: form.cost_training || 0,
      total_value: form.cost_total || 0,
      due_date: form.period_end || null,
      billing_status: 'Pendente',
      reconciliation_status: 'Atrasado',
      created_by: req.user?.id || null
    };

    const { data: newInvoice, error: invoiceError } = await supabase
      .from('rental_invoices')
      .insert([invoicePayload])
      .select()
      .single();

    if (invoiceError) throw invoiceError;

    // 2. Update contract status and link the rental_invoice_id
    const { data: updatedContract, error: updateError } = await supabase
      .from('crm_deal_contracts')
      .update({
        status: 'Processado',
        rental_invoice_id: newInvoice.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // 3. Update the equipment status to 'Locado'
    if (equipment_id) {
      const { error: eqUpdateError } = await supabase
        .from('equipments')
        .update({ status: 'Locado', updated_at: new Date().toISOString() })
        .eq('id', equipment_id);
      if (eqUpdateError) {
        console.error('[logisticsController] Erro ao atualizar status do equipamento:', eqUpdateError);
      }
    }

    res.json(updatedContract);
  } catch (error: any) {
    console.error('[logisticsController] Erro em finishProcessing:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
};

/**
 * POST /api/logistics/contracts/:id/triage-photos
 * Saves a triage photo record and creates a signed URL for the uploaded file.
 * Body: { position: number, label: string, file_path: string }
 */
export const saveTriagePhoto = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const contractId = req.params.id;
    const { position, label, file_path } = req.body;

    if (!position || !label || !file_path) {
      return res.status(400).json({ error: 'position, label e file_path são obrigatórios.' });
    }

    // Create a signed URL (10 years)
    const { data: urlData, error: urlError } = await supabase.storage
      .from('logistics-triage')
      .createSignedUrl(file_path, 60 * 60 * 24 * 365 * 10);

    if (urlError) throw urlError;

    // Upsert to allow re-upload of the same position
    const { data, error } = await supabase
      .from('logistics_triage_photos')
      .upsert({
        contract_id: contractId,
        position,
        label,
        file_path,
        file_url: urlData?.signedUrl,
        uploaded_by: req.user?.id,
        uploaded_at: new Date().toISOString()
      }, { onConflict: 'contract_id,position' })
      .select(`
        *,
        uploaded_by_user:users_profiles!logistics_triage_photos_uploaded_by_fkey(
          id,
          full_name,
          email
        )
      `)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    console.error('[logisticsController] Erro em saveTriagePhoto:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
};

/**
 * GET /api/logistics/contracts/:id/triage-photos
 * Returns all triage photos for a contract ordered by position.
 */
export const getTriagePhotos = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const contractId = req.params.id;

    const { data, error } = await supabase
      .from('logistics_triage_photos')
      .select(`
        *,
        uploaded_by_user:users_profiles!logistics_triage_photos_uploaded_by_fkey(
          id,
          full_name,
          email
        )
      `)
      .eq('contract_id', contractId)
      .order('position', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (error: any) {
    console.error('[logisticsController] Erro em getTriagePhotos:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
};

/**
 * DELETE /api/logistics/contracts/:id/triage-photos/:photoId
 * Deletes a triage photo record and its file from storage.
 */
export const deleteTriagePhoto = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { photoId } = req.params;

    // Fetch photo to get file_path
    const { data: photo, error: fetchError } = await supabase
      .from('logistics_triage_photos')
      .select('file_path')
      .eq('id', photoId)
      .single();

    if (fetchError) throw fetchError;
    if (!photo) return res.status(404).json({ error: 'Foto não encontrada' });

    // Delete from storage
    await supabase.storage.from('logistics-triage').remove([photo.file_path]);

    // Delete from database
    const { error } = await supabase
      .from('logistics_triage_photos')
      .delete()
      .eq('id', photoId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    console.error('[logisticsController] Erro em deleteTriagePhoto:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
};
