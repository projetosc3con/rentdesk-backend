import { randomUUID } from 'crypto';

export function makeInvoice(overrides: Record<string, any> = {}) {
  return {
    id: randomUUID(),
    invoice_number: 'FAT-0001',
    client_id: randomUUID(),
    client_name: 'Cliente Teste',
    equipment_name: 'Retroescavadeira',
    work_site: 'Obra Teste',
    total_value: 1000,
    due_date: '2026-08-25',
    payment_method: 'BOLETO',
    billing_status: 'Pendente',
    ...overrides,
  };
}

export function makeClient(overrides: Record<string, any> = {}) {
  return {
    id: randomUUID(),
    company_name: 'Cliente Teste LTDA',
    cnpj: '00.000.000/0001-00',
    email: 'cliente@example.com',
    phone: '11999999999',
    address_zip: '01000-000',
    address_street: 'Rua Teste',
    address_number: '100',
    asaas_customer_id: null,
    ...overrides,
  };
}

export function makeSettings(overrides: Record<string, any> = {}) {
  return {
    id: randomUUID(),
    active: true,
    asaas_api_key: 'test-asaas-key',
    asaas_boleto_fee_amount: 3.49,
    asaas_pix_fee_percent: 0.0099,
    company_name: 'C3Loc Teste',
    nfse_service_code: '101',
    nfse_iss_regime: 'Isento',
    bank_code: '001',
    bank_agency: '5087',
    bank_account: '12345-6',
    bank_pix_key: 'chave@pix.com',
    bank_pix_key_type: 'EMAIL',
    ...overrides,
  };
}

export function makePayment(overrides: Record<string, any> = {}) {
  return {
    id: randomUUID(),
    invoice_id: randomUUID(),
    client_id: randomUUID(),
    asaas_payment_id: `pay_${randomUUID()}`,
    billing_type: 'BOLETO',
    value: 1003.49,
    net_value: 1000,
    net_value_projected: 1000,
    invoice_url: 'https://asaas.test/i/abc',
    bank_slip_url: 'https://asaas.test/b/abc',
    due_date: '2026-08-25',
    payment_date: null,
    status: 'PENDING',
    is_manual_reconciliation: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeBill(overrides: Record<string, any> = {}) {
  return {
    id: randomUUID(),
    origin: 'MANUAL',
    type: 'receivable',
    rental_invoice_id: null,
    payment_id: null,
    client_id: null,
    counterparty_name: 'Fornecedor Teste',
    description: null,
    gross_value: 1000,
    fee_amount: 0,
    net_value: 1000,
    due_date: '2026-08-25',
    pix_end_to_end_id: null,
    bank_transaction_date: null,
    bank_raw_snapshot: null,
    asaas_transfer_id: null,
    barcode: null,
    status: 'Pendente',
    reconciled_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeBankLine(overrides: Record<string, any> = {}) {
  return {
    bank_date: '2026-08-20',
    value: 1000,
    dc_indicator: 'C' as const,
    type: 'receivable' as const,
    description: 'PIX RECEBIDO',
    document_number: null,
    unique_transaction_id: null,
    raw: {},
    ...overrides,
  };
}
