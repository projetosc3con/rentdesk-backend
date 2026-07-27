export type BillingStatus = 'Pendente' | 'Faturado';
export type ReconciliationStatus = 'Pendente' | 'Recebido';

export interface RentalInvoice {
  id: string;
  client_id: string;
  client_name: string;
  cnpj: string | null;
  equipment_id: string;
  equipment_name: string;
  equipment_type: string | null;
  asset_number: string | null;
  work_site: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  return_date: string | null;
  due_date: string | null;
  payment_method: string | null;
  cost_rental: number;
  cost_insurance: number;
  cost_freight: number;
  cost_rcd: number;
  cost_third_party: number;
  cost_training: number;
  total_value: number;
  billing_status: BillingStatus;
  reconciliation_status: ReconciliationStatus;
  bank_reconciliation_date: string | null;
  invoice_number: string | null;
  notes: string | null;
  created_at: string;
}
