import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Ciclo de vida assíncrono da NFS-e: emissão (SCHEDULED) -> consulta manual de
// status (getNfseStatus reconsulta o gateway) -> evento INVOICE_AUTHORIZED do
// webhook (autorização da prefeitura) -> e-mail disparado só na transição.
vi.mock('../../config/supabase', () => ({
  getSupabaseUserClient: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
  supabase: {},
}));
vi.mock('../../services/asaasService', () => ({
  asaasService: { createInvoice: vi.fn(), getInvoice: vi.fn() },
}));
vi.mock('../../services/emailService', () => ({
  emailService: { sendNfseEmail: vi.fn(), sendBoletoEmail: vi.fn() },
}));

import { getSupabaseUserClient, supabaseAdmin } from '../../config/supabase';
import { asaasService } from '../../services/asaasService';
import { emailService } from '../../services/emailService';
import { installFakeSupabase } from '../helpers/mockSupabaseConfig';
import { buildTestApp, profileHeader } from '../helpers/testApp';
import { makeInvoice, makeClient, makeSettings, makePayment } from '../helpers/fixtures';
import fiscalRoutes from '../../routes/fiscalRoutes';
import asaasWebhookRoutes from '../../routes/asaasWebhookRoutes';
import type { FakeSupabaseDb } from '../helpers/fakeSupabase';

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN!;

function buildWebhookApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', asaasWebhookRoutes);
  return app;
}

describe('Ciclo assíncrono da NFS-e', () => {
  let db: FakeSupabaseDb;
  const fiscalApp = buildTestApp(fiscalRoutes, '/api/fiscal');
  const webhookApp = buildWebhookApp();

  beforeEach(() => {
    db = installFakeSupabase({ getSupabaseUserClient, supabaseAdmin });
    vi.mocked(asaasService.createInvoice).mockReset();
    vi.mocked(asaasService.getInvoice).mockReset();
    vi.mocked(emailService.sendNfseEmail).mockReset().mockResolvedValue(undefined);
  });

  it('emissão -> SCHEDULED -> getNfseStatus reconsulta e atualiza pra AUTHORIZED', async () => {
    const client = makeClient({ email: 'cliente@example.com' });
    const invoice = makeInvoice({ client_id: client.id });
    db.seed('clients', [client]);
    db.seed('rental_invoices', [invoice]);
    db.seed('erp_company_settings', [makeSettings()]);
    db.seed('payments', [makePayment({ invoice_id: invoice.id, asaas_payment_id: 'pay_1' })]);
    vi.mocked(asaasService.createInvoice).mockResolvedValue({ id: 'inv_asaas_1', status: 'SCHEDULED', pdfUrl: null, xmlUrl: null } as any);

    const emitRes = await request(fiscalApp)
      .post(`/api/fiscal/invoices/${invoice.id}/nfse`)
      .set('x-test-profile', profileHeader('Administrador'));
    expect(emitRes.status).toBe(201);
    expect(emitRes.body.nfse.status).toBe('SCHEDULED');

    vi.mocked(asaasService.getInvoice).mockResolvedValue({ status: 'AUTHORIZED', pdfUrl: 'https://asaas.test/nfse.pdf', xmlUrl: null } as any);

    const statusRes = await request(fiscalApp)
      .get(`/api/fiscal/invoices/${invoice.id}/nfse`)
      .set('x-test-profile', profileHeader('Financeiro'));

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('AUTHORIZED');
    expect(statusRes.body.nfse_link).toBe('https://asaas.test/nfse.pdf');
  });

  it('evento INVOICE_AUTHORIZED do webhook atualiza o registro local e dispara o e-mail só na primeira transição', async () => {
    const client = makeClient({ email: 'cliente@example.com' });
    const invoice = makeInvoice({ client_id: client.id, equipment_name: 'Compressor' });
    db.seed('clients', [client]);
    db.seed('rental_invoices', [invoice]);
    db.seed('erp_company_settings', [makeSettings()]);
    db.seed('invoice_nfse', [{ id: 'nfse-1', invoice_id: invoice.id, external_id: 'inv_asaas_1', status: 'SCHEDULED', created_at: new Date().toISOString() }]);

    const payload = {
      id: 'evt_invoice_auth',
      event: 'INVOICE_AUTHORIZED',
      invoice: { id: 'inv_asaas_1', status: 'AUTHORIZED', pdfUrl: 'https://asaas.test/nfse.pdf', xmlUrl: 'https://asaas.test/nfse.xml' },
    };

    const res1 = await request(webhookApp).post('/api/webhooks/asaas').set('asaas-access-token', WEBHOOK_TOKEN).send(payload);
    expect(res1.status).toBe(200);
    const nfse = db.getTable('invoice_nfse').find((n) => n.id === 'nfse-1')!;
    expect(nfse.status).toBe('AUTHORIZED');
    expect(nfse.nfse_link).toBe('https://asaas.test/nfse.pdf');
    expect(emailService.sendNfseEmail).toHaveBeenCalledOnce();

    // Reentrega do mesmo evento (Asaas pode reentregar) -> não manda um segundo e-mail.
    const res2 = await request(webhookApp)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ ...payload, id: 'evt_invoice_auth_retry' });
    expect(res2.status).toBe(200);
    expect(emailService.sendNfseEmail).toHaveBeenCalledOnce();
  });

  it('evento de nota fiscal sem correspondência local (external_id desconhecido) só loga e não quebra', async () => {
    const res = await request(webhookApp)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ id: 'evt_orfao', event: 'INVOICE_UPDATED', invoice: { id: 'inv_desconhecida', status: 'ERROR' } });

    expect(res.status).toBe(200);
    const log = db.getTable('asaas_webhook_logs').find((l) => l.event_id === 'evt_orfao')!;
    expect(log.processed).toBe(true); // handleInvoiceEvent retorna cedo sem lançar
  });
});
