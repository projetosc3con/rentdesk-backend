import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../config/supabase', () => ({
  getSupabaseUserClient: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
  supabase: {},
}));
vi.mock('../../services/asaasService', () => ({
  asaasService: { createInvoice: vi.fn(), getInvoice: vi.fn() },
}));

import { getSupabaseUserClient, supabaseAdmin } from '../../config/supabase';
import { asaasService } from '../../services/asaasService';
import { installFakeSupabase } from '../helpers/mockSupabaseConfig';
import { buildTestApp, profileHeader } from '../helpers/testApp';
import { makeInvoice, makeSettings, makePayment } from '../helpers/fixtures';
import fiscalRoutes from '../../routes/fiscalRoutes';
import type { FakeSupabaseDb } from '../helpers/fakeSupabase';

describe('fiscalRoutes', () => {
  let db: FakeSupabaseDb;
  const app = buildTestApp(fiscalRoutes, '/api/fiscal');

  beforeEach(() => {
    db = installFakeSupabase({ getSupabaseUserClient, supabaseAdmin });
    vi.mocked(asaasService.createInvoice).mockReset();
    vi.mocked(asaasService.getInvoice).mockReset();
  });

  describe('POST /invoices/:id/nfse', () => {
    it('nega acesso sem role liberada', async () => {
      const res = await request(app)
        .post('/api/fiscal/invoices/inv-1/nfse')
        .set('x-test-profile', profileHeader('Comercial'));
      expect(res.status).toBe(403);
    });

    it('emite a NFS-e isenta (Súmula Vinculante 31) quando não há cobrança gerada -> erro claro', async () => {
      const invoice = makeInvoice();
      db.seed('rental_invoices', [invoice]);
      db.seed('erp_company_settings', [makeSettings()]);
      // sem payments para essa invoice

      const res = await request(app)
        .post(`/api/fiscal/invoices/${invoice.id}/nfse`)
        .set('x-test-profile', profileHeader('Administrador'));

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/sem cobrança Asaas/);
    });

    it('emite com sucesso e persiste invoice_nfse com status SCHEDULED (assíncrono)', async () => {
      const invoice = makeInvoice();
      db.seed('rental_invoices', [invoice]);
      db.seed('erp_company_settings', [makeSettings({ nfse_iss_regime: 'Isento' })]);
      db.seed('payments', [makePayment({ invoice_id: invoice.id, asaas_payment_id: 'pay_1' })]);
      vi.mocked(asaasService.createInvoice).mockResolvedValue({
        id: 'inv_asaas_1',
        status: 'SCHEDULED',
        pdfUrl: null,
        xmlUrl: null,
      } as any);

      const res = await request(app)
        .post(`/api/fiscal/invoices/${invoice.id}/nfse`)
        .set('x-test-profile', profileHeader('Administrador'));

      expect(res.status).toBe(201);
      expect(res.body.nfse.status).toBe('SCHEDULED');
      const created = vi.mocked(asaasService.createInvoice).mock.calls[0][1];
      expect(created.taxes?.iss).toBe(0);
      expect(created.taxes?.retainIss).toBe(false);
    });

    it('em falha no gateway, registra ERRO em invoice_nfse mesmo respondendo 500', async () => {
      const invoice = makeInvoice();
      db.seed('rental_invoices', [invoice]);
      db.seed('erp_company_settings', [makeSettings()]);
      db.seed('payments', [makePayment({ invoice_id: invoice.id, asaas_payment_id: 'pay_1' })]);
      vi.mocked(asaasService.createInvoice).mockRejectedValue(new Error('Asaas indisponível'));

      const res = await request(app)
        .post(`/api/fiscal/invoices/${invoice.id}/nfse`)
        .set('x-test-profile', profileHeader('Administrador'));

      expect(res.status).toBe(500);
      const logged = db.getTable('invoice_nfse').find((n) => n.invoice_id === invoice.id);
      expect(logged?.status).toBe('ERRO');
    });
  });

  describe('GET /invoices/:id/nfse', () => {
    it('nega acesso pra role fora do conjunto liberado', async () => {
      const res = await request(app)
        .get('/api/fiscal/invoices/inv-1/nfse')
        .set('x-test-profile', profileHeader('Comercial'));
      expect(res.status).toBe(403);
    });

    it('404 quando ainda não há nota emitida', async () => {
      const res = await request(app)
        .get('/api/fiscal/invoices/inv-sem-nota/nfse')
        .set('x-test-profile', profileHeader('Financeiro'));
      expect(res.status).toBe(404);
    });

    it('em status terminal (AUTHORIZED), não reconsulta o gateway', async () => {
      const invoice = makeInvoice();
      db.seed('invoice_nfse', [{ invoice_id: invoice.id, status: 'AUTHORIZED', external_id: 'inv_asaas_1', created_at: new Date().toISOString() }]);

      const res = await request(app)
        .get(`/api/fiscal/invoices/${invoice.id}/nfse`)
        .set('x-test-profile', profileHeader('Financeiro'));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('AUTHORIZED');
      expect(asaasService.getInvoice).not.toHaveBeenCalled();
    });

    it('em status não-terminal, reconsulta o gateway e atualiza o registro local', async () => {
      const invoice = makeInvoice();
      db.seed('invoice_nfse', [{ id: 'nfse-1', invoice_id: invoice.id, status: 'SCHEDULED', external_id: 'inv_asaas_1', nfse_link: null, created_at: new Date().toISOString() }]);
      db.seed('erp_company_settings', [makeSettings()]);
      vi.mocked(asaasService.getInvoice).mockResolvedValue({ status: 'AUTHORIZED', pdfUrl: 'https://asaas.test/nfse.pdf' } as any);

      const res = await request(app)
        .get(`/api/fiscal/invoices/${invoice.id}/nfse`)
        .set('x-test-profile', profileHeader('Financeiro'));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('AUTHORIZED');
      expect(res.body.nfse_link).toBe('https://asaas.test/nfse.pdf');
    });
  });
});
