export type BillOrigin = 'ASAAS' | 'MANUAL';
export type BillType = 'receivable' | 'payable';
export type BillStatus = 'Pendente' | 'Atrasado' | 'Recebido' | 'Divergente' | 'No prazo';

export interface Bill {
  id: string;
  origin: BillOrigin;
  type: BillType;
  rental_invoice_id: string | null;
  payment_id: string | null;
  client_id: string | null;
  counterparty_name: string | null;
  description: string | null;
  gross_value: number;
  fee_amount: number | null;
  net_value: number;
  due_date: string | null;
  pix_end_to_end_id: string | null;
  bank_transaction_date: string | null;
  bank_raw_snapshot: Record<string, unknown> | null;
  status: BillStatus;
  reconciled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateBillPayload {
  type: BillType;
  client_id?: string;
  counterparty_name?: string;
  description?: string;
  gross_value: number;
  due_date: string;
  already_settled?: boolean;
  settled_date?: string;
}
