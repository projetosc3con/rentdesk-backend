export type CRMLeadStatus = 'Novo' | 'Em Contato' | 'Qualificado' | 'Desqualificado' | 'Convertido';
export type CRMLeadSource = 'Indicação' | 'Site' | 'Evento' | 'Cold Call' | 'Rede Social' | 'Parceiro' | 'Outro';

export interface CRMLead {
  id: string;
  company_name: string;
  cnpj?: string;
  segment?: string;
  estimated_potential?: number;
  source?: CRMLeadSource;
  status: CRMLeadStatus;
  converted_at?: string;
  converted_client_id?: string;
  owner_id: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface CRMContact {
  id: string;
  lead_id?: string;
  client_id?: string;
  full_name: string;
  role_title?: string;
  department?: string;
  email?: string;
  phone?: string;
  is_primary: boolean;
  notes?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CRMPipeline {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CRMPipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  probability_pct?: number;
  created_at: string;
}

export interface CRMDeal {
  id: string;
  title: string;
  pipeline_id: string;
  stage_id: string;
  lead_id?: string;
  client_id?: string;
  primary_contact_id?: string;
  owner_id: string;
  value?: number;
  probability_pct?: number;
  expected_close_date?: string;
  closed_at?: string;
  lost_reason?: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export type CRMActivityType = 'Nota' | 'Ligação' | 'E-mail' | 'Reunião' | 'Mudança de Etapa' | 'Proposta Enviada' | 'Visita Técnica';

export interface CRMDealActivity {
  id: string;
  deal_id: string;
  activity_type: CRMActivityType;
  description: string;
  stage_from_id?: string;
  stage_to_id?: string;
  contact_id?: string;
  performed_by: string;
  activity_date: string;
  created_at: string;
}

export interface CRMTaskType {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export type CRMTaskStatus = 'Pendente' | 'Em Andamento' | 'Concluída' | 'Cancelada';
export type CRMTaskPriority = 'Baixa' | 'Normal' | 'Alta' | 'Urgente';

export interface CRMTask {
  id: string;
  task_type_id: string;
  title: string;
  description?: string;
  deal_id?: string;
  lead_id?: string;
  contact_id?: string;
  assigned_to: string;
  created_by: string;
  due_date: string;
  completed_at?: string;
  status: CRMTaskStatus;
  priority: CRMTaskPriority;
  notes?: string;
  created_at: string;
  updated_at: string;
}
