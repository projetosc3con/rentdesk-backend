import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../config/supabase', () => ({
  getSupabaseUserClient: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
  supabase: {},
}));
vi.mock('../../services/asaasService', () => ({
  asaasService: { createCharge: vi.fn(), getPayment: vi.fn() },
}));
vi.mock('../../services/emailService', () => ({
  emailService: { sendBoletoEmail: vi.fn() },
}));

import { getSupabaseUserClient, supabaseAdmin } from '../../config/supabase';
import { asaasService } from '../../services/asaasService';
import { emailService } from '../../services/emailService';
import { installFakeSupabase } from '../helpers/mockSupabaseConfig';
import { buildTestApp, profileHeader } from '../helpers/testApp';
import { makeInvoice, makeClient, makeSettings, makePayment } from '../helpers/fixtures';
import paymentRoutes from '../../routes/paymentRoutes';
import type { FakeSupabaseDb } from '../helpers/fakeSupabase';
import type { AsaasPaymentResponse } from '../../types/asaas';

function asaasCharge(overrides: Partial<AsaasPaymentResponse> = {}): AsaasPaymentResponse {
  return {
    id: 'pay_123',
    customer: 'cus_1',
    value: 1003.49,
    netValue: 1000,
    billingType: 'BOLETO',
    status: 'PENDING',
    dueDate: '2026-08-25',
    paymentDate: null,
    invoiceUrl: 'https://asaas.test/i/1',
    bankSlipUrl: 'https://asaas.test/b/1',
    externalReference: 'invoice-1',
    deleted: false,
    ...overrides,
  };
}

describe('paymentRoutes', () => {
  let db: FakeSupabaseDb;
  const app = buildTestApp(paymentRoutes, '/api/payments');

  beforeEach(() => {
    db = installFakeSupabase({ getSupabaseUserClient, supabaseAdmin });
    vi.mocked(asaasService.createCharge).mockReset();
    vi.mocked(asaasService.getPayment).mockReset();
    vi.mocked(emailService.sendBoletoEmail).mockReset().mockResolvedValue(undefined);
  });

  describe('POST /invoices/:id/charge', () => {
    it('nega acesso pra role fora do conjunto liberado (Comercial não emite boleto — só Financeiro/Logística/irrestrito)', async () => {
      const res = await request(app)
        .post('/api/payments/invoices/does-not-exist/charge')
        .set('x-test-profile', profileHeader('Comercial'));
      expect(res.status).toBe(403);
    });

    it('libera Logística, pedido explícito do Victor (emitir boleto)', async () => {
      const client = makeClient({ asaas_customer_id: 'cus_1' });
      const invoice = makeInvoice({ client_id: client.id, total_value: 1000, payment_method: 'BOLETO' });
      db.seed('rental_invoices', [invoice]);
      db.seed('clients', [client]);
      db.seed('erp_company_settings', [makeSettings()]);
      vi.mocked(asaasService.createCharge).mockResolvedValue(asaasCharge());

      const res = await request(app)
        .post(`/api/payments/invoices/${invoice.id}/charge`)
        .set('x-test-profile', profileHeader('Logística'));

      expect(res.status).toBe(201);
    });

    it('404 quando a fatura não existe', async () => {
      const res = await request(app)
        .post('/api/payments/invoices/does-not-exist/charge')
        .set('x-test-profile', profileHeader('Financeiro'));
      expect(res.status).toBe(404);
    });

    it('400 quando a locadora não tem chave Asaas configurada', async () => {
      const invoice = makeInvoice();
      db.seed('rental_invoices', [invoice]);
      db.seed('erp_company_settings', [makeSettings({ asaas_api_key: null })]);

      const res = await request(app)
        .post(`/api/payments/invoices/${invoice.id}/charge`)
        .set('x-test-profile', profileHeader('Financeiro'));
      expect(res.status).toBe(400);
    });

    it('400 quando o cliente não tem asaas_customer_id', async () => {
      const client = makeClient({ asaas_customer_id: null });
      const invoice = makeInvoice({ client_id: client.id });
      db.seed('rental_invoices', [invoice]);
      db.seed('clients', [client]);
      db.seed('erp_company_settings', [makeSettings()]);

      const res = await request(app)
        .post(`/api/payments/invoices/${invoice.id}/charge`)
        .set('x-test-profile', profileHeader('Financeiro'));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/asaas_customer_id/);
    });

    it('cobrança de BOLETO emite o valor total exato do contrato (sem repassar taxa ao cliente)', async () => {
      const client = makeClient({ asaas_customer_id: 'cus_1' });
      const invoice = makeInvoice({ client_id: client.id, total_value: 1000, payment_method: 'BOLETO' });
      db.seed('rental_invoices', [invoice]);
      db.seed('clients', [client]);
      db.seed('erp_company_settings', [makeSettings({ asaas_boleto_fee_amount: 3.49 })]);
      vi.mocked(asaasService.createCharge).mockResolvedValue(asaasCharge({ value: 1000, netValue: 996.51 }));

      const res = await request(app)
        .post(`/api/payments/invoices/${invoice.id}/charge`)
        .set('x-test-profile', profileHeader('Financeiro'));

      expect(res.status).toBe(201);
      expect(vi.mocked(asaasService.createCharge).mock.calls[0][1].value).toBe(1000);
      expect(res.body.breakdown.fee_amount).toBeCloseTo(3.49, 2);
      expect(res.body.breakdown.charged_value).toBe(1000);
      expect(res.body.email_sent).toBe(true);
    });

    it('cobrança de PIX emite o valor total exato do contrato (sem repassar taxa ao cliente)', async () => {
      const client = makeClient({ asaas_customer_id: 'cus_1' });
      const invoice = makeInvoice({ client_id: client.id, total_value: 1000, payment_method: 'PIX' });
      db.seed('rental_invoices', [invoice]);
      db.seed('clients', [client]);
      db.seed('erp_company_settings', [makeSettings({ asaas_pix_fee_percent: 0.01 })]);
      vi.mocked(asaasService.createCharge).mockImplementation(async (_key, data) =>
        asaasCharge({ value: data.value, netValue: 990 })
      );

      const res = await request(app)
        .post(`/api/payments/invoices/${invoice.id}/charge`)
        .set('x-test-profile', profileHeader('Financeiro'));

      expect(res.status).toBe(201);
      expect(res.body.breakdown.charged_value).toBe(1000);
      expect(res.body.breakdown.fee_amount).toBe(10);
    });

    it('sem taxa configurada, cobra o total_value sem gross-up e não quebra', async () => {
      const client = makeClient({ asaas_customer_id: 'cus_1' });
      const invoice = makeInvoice({ client_id: client.id, total_value: 1000, payment_method: 'BOLETO' });
      db.seed('rental_invoices', [invoice]);
      db.seed('clients', [client]);
      db.seed('erp_company_settings', [makeSettings({ asaas_boleto_fee_amount: null })]);
      vi.mocked(asaasService.createCharge).mockResolvedValue(asaasCharge({ value: 1000, netValue: 1000 }));

      const res = await request(app)
        .post(`/api/payments/invoices/${invoice.id}/charge`)
        .set('x-test-profile', profileHeader('Financeiro'));

      expect(res.body.breakdown.fee_amount).toBe(0);
      expect(res.body.breakdown.charged_value).toBe(1000);
    });

    it('idempotência: fatura com cobrança ativa devolve a cobrança existente em vez de criar outra', async () => {
      const client = makeClient({ asaas_customer_id: 'cus_1' });
      const invoice = makeInvoice({ client_id: client.id });
      const existingPayment = makePayment({ invoice_id: invoice.id, status: 'PENDING' });
      db.seed('rental_invoices', [invoice]);
      db.seed('clients', [client]);
      db.seed('erp_company_settings', [makeSettings()]);
      db.seed('payments', [existingPayment]);

      const res = await request(app)
        .post(`/api/payments/invoices/${invoice.id}/charge`)
        .set('x-test-profile', profileHeader('Financeiro'));

      expect(res.status).toBe(200);
      expect(res.body.payment.id).toBe(existingPayment.id);
      expect(asaasService.createCharge).not.toHaveBeenCalled();
      expect(db.getTable('payments')).toHaveLength(1);
    });

    it('uma cobrança CANCELLED não bloqueia a criação de uma nova', async () => {
      const client = makeClient({ asaas_customer_id: 'cus_1' });
      const invoice = makeInvoice({ client_id: client.id });
      db.seed('rental_invoices', [invoice]);
      db.seed('clients', [client]);
      db.seed('erp_company_settings', [makeSettings()]);
      db.seed('payments', [makePayment({ invoice_id: invoice.id, status: 'CANCELLED' })]);
      vi.mocked(asaasService.createCharge).mockResolvedValue(asaasCharge());

      const res = await request(app)
        .post(`/api/payments/invoices/${invoice.id}/charge`)
        .set('x-test-profile', profileHeader('Financeiro'));

      expect(res.status).toBe(201);
      expect(asaasService.createCharge).toHaveBeenCalledOnce();
      expect(db.getTable('payments')).toHaveLength(2);
    });

    it('corrida documentada: 23505 no insert devolve a cobrança do vencedor em vez de 500 (comportamento atual, não corrigido)', async () => {
      const client = makeClient({ asaas_customer_id: 'cus_1' });
      const invoice = makeInvoice({ client_id: client.id });
      db.seed('rental_invoices', [invoice]);
      db.seed('clients', [client]);
      db.seed('erp_company_settings', [makeSettings()]);
      vi.mocked(asaasService.createCharge).mockResolvedValue(asaasCharge({ id: 'pay_race' }));

      // Simula a corrida: a checagem de idempotência inicial roda antes de
      // qualquer payment existir (não encontra nada), mas quando o insert
      // desta requisição roda, a "outra" requisição já venceu — o insert
      // recebe 23505 e, nesse exato momento, a linha vencedora aparece na
      // tabela (sideEffect), pra fetchActivePayment() encontrá-la no catch.
      const winner = makePayment({ invoice_id: invoice.id, asaas_payment_id: 'pay_winner' });
      db.forceNextError(
        'payments',
        'insert',
        { code: '23505', message: 'duplicate key value violates unique constraint' },
        () => db.getTable('payments').push(winner)
      );

      const res = await request(app)
        .post(`/api/payments/invoices/${invoice.id}/charge`)
        .set('x-test-profile', profileHeader('Financeiro'));

      expect(res.status).toBe(200);
      expect(res.body.payment.id).toBe(winner.id);
      expect(db.getTable('payments')).toHaveLength(1); // o insert que perdeu a corrida não persistiu nada
    });
  });

  describe('GET /invoices/:id', () => {
    it('nega acesso pra role fora do conjunto liberado', async () => {
      const res = await request(app)
        .get('/api/payments/invoices/invoice-1')
        .set('x-test-profile', profileHeader('Comercial'));
      expect(res.status).toBe(403);
    });

    it('lista os pagamentos de uma fatura, mais recente primeiro', async () => {
      const invoiceId = 'invoice-1';
      const older = makePayment({ invoice_id: invoiceId, created_at: '2026-01-01T00:00:00.000Z' });
      const newer = makePayment({ invoice_id: invoiceId, created_at: '2026-02-01T00:00:00.000Z' });
      db.seed('payments', [older, newer]);

      const res = await request(app)
        .get(`/api/payments/invoices/${invoiceId}`)
        .set('x-test-profile', profileHeader('Financeiro'));

      expect(res.status).toBe(200);
      expect(res.body[0].id).toBe(newer.id);
      expect(res.body[1].id).toBe(older.id);
    });
  });

  describe('GET /api/payments', () => {
    it('nega acesso sem role liberada', async () => {
      const res = await request(app).get('/api/payments').set('x-test-profile', profileHeader('Comercial'));
      expect(res.status).toBe(403);
    });

    it('lista pagamentos com role liberada (irrestrito)', async () => {
      db.seed('payments', [makePayment()]);
      const res = await request(app).get('/api/payments').set('x-test-profile', profileHeader('Diretoria'));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('libera Financeiro (ler e alterar sem excluir)', async () => {
      db.seed('payments', [makePayment()]);
      const res = await request(app).get('/api/payments').set('x-test-profile', profileHeader('Financeiro'));
      expect(res.status).toBe(200);
    });
  });
});
