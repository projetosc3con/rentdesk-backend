import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getSupabaseUserClient, supabaseAdmin } from '../config/supabase';
// Pipelines
export const getPipelines = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data: pipelines, error: pipelinesError } = await supabase
      .from('crm_pipelines')
      .select('*')
      .order('created_at', { ascending: true });

    if (pipelinesError) throw pipelinesError;

    const { data: stages, error: stagesError } = await supabase
      .from('crm_pipeline_stages')
      .select('*')
      .order('position', { ascending: true });

    if (stagesError) throw stagesError;

    // For active deals, we would query crm_deals, but let's just return 0 for now
    const pipelinesWithDetails = pipelines.map(p => ({
      ...p,
      stages: stages.filter(s => s.pipeline_id === p.id).length,
      activeDeals: 0,
      stageList: stages.filter(s => s.pipeline_id === p.id)
    }));

    res.json(pipelinesWithDetails);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTaskTypes = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { data, error } = await supabase
      .from('crm_task_types')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createPipeline = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { name, description, stages } = req.body;

    const { data: pipeline, error: pipelineError } = await supabase
      .from('crm_pipelines')
      .insert([{ name, description, active: true }])
      .select()
      .single();

    if (pipelineError) throw pipelineError;

    if (stages && stages.length > 0) {
      const stagesToInsert = stages.map((s: any, index: number) => ({
        pipeline_id: pipeline.id,
        name: s.name,
        position: index + 1,
        is_won: s.isWon || s.is_won || false,
        is_lost: s.isLost || s.is_lost || false,
        probability_pct: s.probability || s.probability_pct || 0
      }));

      const { error: stagesError } = await supabase
        .from('crm_pipeline_stages')
        .insert(stagesToInsert);

      if (stagesError) throw stagesError;
    }

    res.status(201).json(pipeline);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updatePipeline = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { id } = req.params;
    const { name, description, active, stages } = req.body;

    const { data: pipeline, error: pipelineError } = await supabase
      .from('crm_pipelines')
      .update({ name, description, active })
      .eq('id', id)
      .select()
      .single();

    if (pipelineError) throw pipelineError;

    if (stages) {
      // For simplicity, delete old stages and insert new ones
      const { error: deleteError } = await supabase
        .from('crm_pipeline_stages')
        .delete()
        .eq('pipeline_id', id);

      if (deleteError) throw deleteError;

      if (stages.length > 0) {
        const stagesToInsert = stages.map((s: any, index: number) => ({
          pipeline_id: id,
          name: s.name,
          position: index + 1,
          is_won: s.isWon || s.is_won || false,
          is_lost: s.isLost || s.is_lost || false,
          probability_pct: s.probability || s.probability_pct || 0
        }));

        const { error: stagesError } = await supabase
          .from('crm_pipeline_stages')
          .insert(stagesToInsert);

        if (stagesError) throw stagesError;
      }
    }

    res.json(pipeline);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deletePipeline = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { id } = req.params;

    // First delete stages (cascade if configured, but good to be explicit)
    await supabase.from('crm_pipeline_stages').delete().eq('pipeline_id', id);

    const { error } = await supabase
      .from('crm_pipelines')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Leads
export const getLeads = async (req: AuthRequest, res: Response) => {
  try {
    // Usando supabaseAdmin para bypass de RLS, assim perfis 'Comercial' podem VER todos os leads
    const { data, error } = await supabaseAdmin
      .from('crm_leads')
      .select(`
        *,
        owner:users_profiles!owner_id(full_name)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Flatten owner name
    const leads = data.map(lead => ({
      ...lead,
      owner_name: lead.owner?.full_name
    }));

    res.json(leads);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createLead = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { contacts, ...leadData } = req.body;
    
    // Insert lead
    const { data: lead, error: leadError } = await supabase
      .from('crm_leads')
      .insert([leadData])
      .select()
      .single();

    if (leadError) throw leadError;

    // Insert contacts if provided
    if (contacts && contacts.length > 0) {
      const contactsToInsert = contacts.map((c: any) => ({
        ...c,
        lead_id: lead.id
      }));

      const { error: contactsError } = await supabase
        .from('crm_contacts')
        .insert(contactsToInsert);

      if (contactsError) throw contactsError;
    }

    res.status(201).json(lead);
  } catch (error: any) {
    console.error('[crmController] Erro em createLead:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor', details: error });
  }
};

export const updateLead = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { id } = req.params;
    const { contacts, owner, owner_name, ...leadData } = req.body;

    // Verificar propriedade
    const { data: existingLead, error: existingLeadError } = await supabase
      .from('crm_leads')
      .select('owner_id')
      .eq('id', id)
      .single();
      
    if (existingLeadError) throw existingLeadError;
    
    if (req.profile?.access_level === 'Comercial' && existingLead.owner_id !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado. Você só pode editar leads que pertencem a você.' });
    }

    const { data: lead, error: leadError } = await supabase
      .from('crm_leads')
      .update(leadData)
      .eq('id', id)
      .select()
      .single();

    if (leadError) throw leadError;

    if (contacts) {
      // Simplesmente apagamos e reinserimos os contatos
      await supabase.from('crm_contacts').delete().eq('lead_id', id);
      
      if (contacts.length > 0) {
        const contactsToInsert = contacts.map((c: any) => {
          const { id: contactId, created_at, lead_id, ...contactData } = c; // remove campos que não devem ser inseridos
          return {
            ...contactData,
            lead_id: lead.id
          };
        });
        const { error: contactsError } = await supabase
          .from('crm_contacts')
          .insert(contactsToInsert);
        
        if (contactsError) throw contactsError;
      }
    }
    
    res.json(lead);
  } catch (error: any) {
    console.error('[crmController] Erro em updateLead:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor', details: error });
  }
};

export const getLeadContacts = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { id } = req.params;

    const { data, error } = await supabase
      .from('crm_contacts')
      .select('*')
      .eq('lead_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    console.error('[crmController] Erro em getLeadContacts:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor', details: error });
  }
};

export const convertLead = async (req: AuthRequest, res: Response) => {
  try {
    const supabase = getSupabaseUserClient(req.token!);
    const { id } = req.params;

    // 1. Buscar o lead atual
    const { data: lead, error: fetchError } = await supabase
      .from('crm_leads')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;
    
    if (req.profile?.access_level === 'Comercial' && lead.owner_id !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado. Você só pode converter leads que pertencem a você.' });
    }

    if (lead.status === 'Convertido') {
      return res.status(400).json({ error: 'Lead já foi convertido.' });
    }

    // 2. Buscar dados adicionais no opencnpj
    let clientData: any = {
      company_name: lead.company_name,
      cnpj: lead.cnpj || '',
      segment: lead.segment || '',
      active: true
    };

    if (lead.cnpj) {
      const unmaskedCnpj = lead.cnpj.replace(/\D/g, '');
      if (unmaskedCnpj.length === 14) {
        try {
          const response = await fetch(`https://api.opencnpj.org/${unmaskedCnpj}`);
          if (response.ok) {
            const data: any = await response.json();
            
            const tipo_logradouro = data.tipo_logradouro || '';
            const logradouro = data.logradouro || '';
            const numero = data.numero || '';
            const bairro = data.bairro || '';
            const municipio = data.municipio || '';
            const uf = data.uf || '';
            const cepStr = (data.cep || '').replace(/\D/g, '');
            const cep_formatado = cepStr.length === 8 ? `${cepStr.slice(0, 5)}-${cepStr.slice(5)}` : data.cep || '';
            const address_street = `${tipo_logradouro} ${logradouro}`.trim();
            const address_complement = `${tipo_logradouro} ${logradouro} Nº ${numero}, ${bairro}, ${municipio} - ${uf} CEP: ${cep_formatado}`.trim();

            clientData = {
              ...clientData,
              company_name: data.razao_social || data.razao_scoial || lead.company_name,
              address_street,
              address_number: numero,
              address_complement,
              address_city: municipio,
              address_state: uf,
              address_zip: cep_formatado,
              email: data.email || '',
              phone: data.telefones?.[0] ? `(${data.telefones[0].ddd}) ${data.telefones[0].numero}` : ''
            };
          }
        } catch (err) {
          console.error('[crmController] Erro ao buscar CNPJ (opencnpj):', err);
        }
      }
    }

    // 3. Inserir na tabela clients
    const { data: newClient, error: clientError } = await supabase
      .from('clients')
      .insert([clientData])
      .select()
      .single();

    if (clientError) throw clientError;

    // 4. Migrar contatos (crm_contacts -> vinculá-los ao client_id)
    await supabase
      .from('crm_contacts')
      .update({ client_id: newClient.id })
      .eq('lead_id', id);

    // 5. Atualizar status do lead
    const { data: updatedLead, error: updateLeadError } = await supabase
      .from('crm_leads')
      .update({
        status: 'Convertido',
        converted_at: new Date().toISOString(),
        converted_client_id: newClient.id
      })
      .eq('id', id)
      .select()
      .single();

    if (updateLeadError) throw updateLeadError;

    res.json({ client: newClient, lead: updatedLead });
  } catch (error: any) {
    console.error('[crmController] Erro em convertLead:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor', details: error });
  }
};

