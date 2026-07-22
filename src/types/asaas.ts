export type AsaasBillingType =
  | 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'TRANSFER' | 'DEPOSIT' | 'PIX';

export type AsaasPaymentStatus =
  | 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'OVERDUE' | 'REFUNDED' | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED' | 'REFUND_IN_PROGRESS' | 'CHARGEBACK_REQUESTED' | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL' | 'DUNNING_REQUESTED' | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS' | 'CANCELLED';

// --- Subconta (POST /v3/accounts) ---
// Best-effort: não veio nos docs colados pelo usuário. Validar contra a doc
// oficial do Asaas antes de ir pra produção.
export interface AsaasSubaccountRequest {
  name: string;
  email: string;
  cpfCnpj: string;
  companyType?: 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION';
  mobilePhone: string;
  address: string;
  addressNumber: string;
  province: string; // bairro
  postalCode: string;
  incomeValue: number;
}

export interface AsaasSubaccountResponse {
  id: string;
  apiKey: string; // -> persistir em erp_company_settings.asaas_api_key
  walletId: string;
  email: string;
  loginEmail: string;
}

// --- Customer (POST /v3/customers) --- (best-effort, mesma ressalva)
export interface AsaasCustomerRequest {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  externalReference?: string; // sugestão: clients.id
  notificationDisabled?: boolean;
}

export interface AsaasCustomerResponse {
  id: string; // -> persistir em clients.asaas_customer_id
  name: string;
  cpfCnpj: string;
  personType: 'FISICA' | 'JURIDICA';
  deleted: boolean;
}

// --- Cobrança (POST /v3/payments) --- (best-effort, mesma ressalva)
export interface AsaasChargeRequest {
  customer: string; // asaas_customer_id
  billingType: AsaasBillingType;
  value: number;
  dueDate: string; // YYYY-MM-DD
  description?: string;
  externalReference?: string; // sugestão: payments.id
}

// Resposta de cobrança — reaproveitada pela resposta de receiveInCash
// (ambas retornam o objeto Payment completo do Asaas / PaymentGetResponseDTO).
export interface AsaasPaymentResponse {
  id: string; // -> persistir em payments.asaas_payment_id
  customer: string;
  value: number;
  netValue: number;
  billingType: AsaasBillingType;
  status: AsaasPaymentStatus;
  dueDate: string;
  paymentDate?: string | null;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  externalReference?: string;
  deleted: boolean;
}

// --- Confirmar recebimento em dinheiro (POST /v3/payments/{id}/receiveInCash) ---
// Campos confirmados na doc colada pelo usuário.
export interface AsaasReceiveInCashRequest {
  paymentDate: string; // YYYY-MM-DD
  value: number;
  notifyCustomer: boolean;
}

export type AsaasReceiveInCashResponse = AsaasPaymentResponse;

// --- Payload de webhook (foco em PAYMENT_RECEIVED) ---
// Best-effort: doc colada não trouxe o envelope de webhook. Validar o nome do
// campo id (chave de dedup para asaas_webhook_logs.event_id) contra a doc real
// antes de confiar nele.
export interface AsaasWebhookPayload {
  id: string; // assumido como id único do evento -> event_id
  event: string; // ex: 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE'
  payment: AsaasPaymentResponse;
}
