import { AsaasBillingType, AsaasPaymentStatus } from './asaas';

export interface Payment {
  id: string;
  invoice_id: string;
  client_id: string;
  asaas_payment_id: string | null;
  billing_type: AsaasBillingType;
  value: number;
  net_value: number | null;
  net_value_projected: number | null;
  invoice_url: string | null;
  bank_slip_url: string | null;
  due_date: string;
  payment_date: string | null;
  status: AsaasPaymentStatus;
  is_manual_reconciliation: boolean;
  created_at: string;
}

export interface PaymentBreakdown {
  total_value: number;
  fee_amount: number;
  charged_value: number;
  net_value: number | null;
}

export interface AsaasWebhookLog {
  id: string;
  event_id: string;
  event_type: string;
  payment_id: string;
  payload: Record<string, unknown>;
  processed: boolean;
  created_at: string;
}
