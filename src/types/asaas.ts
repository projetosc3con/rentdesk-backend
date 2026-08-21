export type AsaasBillingType =
  | 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'TRANSFER' | 'DEPOSIT' | 'PIX';

export type AsaasPaymentStatus =
  | 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'OVERDUE' | 'REFUNDED' | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED' | 'REFUND_IN_PROGRESS' | 'CHARGEBACK_REQUESTED' | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL' | 'DUNNING_REQUESTED' | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS' | 'CANCELLED';

// --- Customer (POST /v3/customers) --- (best-effort, mesma ressalva)
export interface AsaasCustomerRequest {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  postalCode?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string; // bairro
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

// --- Payload de webhook (pagamentos, notas fiscais e transferências) ---
// Best-effort: doc colada não trouxe o envelope de webhook. Validar o nome do
// campo id (chave de dedup para asaas_webhook_logs.event_id) contra a doc real
// antes de confiar nele. payment/invoice/transfer são mutuamente exclusivos:
// eventos PAYMENT_* trazem `payment`, INVOICE_* trazem `invoice`, TRANSFER_*
// trazem `transfer`.
export interface AsaasWebhookPayload {
  id: string; // assumido como id único do evento -> event_id
  event: string; // ex: 'PAYMENT_RECEIVED', 'INVOICE_AUTHORIZED', 'TRANSFER_DONE'
  payment?: AsaasPaymentResponse;
  invoice?: AsaasInvoiceResponse;
  transfer?: AsaasTransferResponse;
}

// --- Transferência (POST /v3/transfers) --- (best-effort, validar contra doc oficial do Asaas antes de produção)
export type AsaasTransferStatus =
  | 'PENDING' | 'BANK_PROCESSING' | 'DONE' | 'FAILED' | 'CANCELLED';

export interface AsaasTransferRequest {
  value: number;
  pixAddressKey: string;
  pixAddressKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
  description?: string;
  externalReference?: string; // sugestão: payments.id
}

export interface AsaasTransferResponse {
  id: string; // -> persistir em bills.asaas_transfer_id
  status: AsaasTransferStatus;
  value: number;
  netValue?: number;
  transferFee?: number;
  effectiveDate?: string | null; // -> bills.bank_transaction_date quando status=DONE
  endToEndIdentifier?: string | null; // -> bills.pix_end_to_end_id quando status=DONE
  failReason?: string | null;
}

// --- Payload do mecanismo de validação de saque (Integrações > Mecanismos de
// Segurança no painel Asaas) — POST síncrono, espera resposta em segundos.
export interface AsaasWithdrawValidationPayload {
  type: 'TRANSFER' | 'BILL' | 'PIX_QR_CODE' | 'MOBILE_PHONE_RECHARGE' | 'PIX_REFUND';
  transfer?: AsaasTransferResponse;
}

// --- Nota fiscal de serviço (POST /v3/invoices) --- (best-effort, validar contra doc oficial do Asaas)
export type AsaasInvoiceStatus =
  | 'SCHEDULED' | 'SYNCHRONIZED' | 'AUTHORIZED' | 'PROCESSING_CANCELLATION'
  | 'CANCELLED' | 'CANCELLATION_DENIED' | 'ERROR';

export interface AsaasInvoiceRequest {
  payment?: string; // asaas_payment_id da cobrança já criada
  customer?: string; // alternativa sem payment vinculado
  serviceDescription: string;
  observations?: string;
  value: number;
  deductions?: number;
  effectiveDate: string; // YYYY-MM-DD
  municipalServiceCode?: string;
  taxes?: {
    retainIss?: boolean;
    iss?: number; // alíquota, 0 quando isento
  };
}

export interface AsaasInvoiceResponse {
  id: string; // -> persistir em invoice_nfse.external_id
  status: AsaasInvoiceStatus;
  pdfUrl?: string;   // -> invoice_nfse.nfse_link
  xmlUrl?: string;   // -> invoice_nfse.xml_url
  errors?: { code: string; description: string }[]; // -> invoice_nfse.return_message
}
