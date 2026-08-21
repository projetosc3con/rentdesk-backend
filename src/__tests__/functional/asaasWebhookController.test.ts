import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../config/supabase', () => ({
  getSupabaseUserClient: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
  supabase: {},
}));
vi.mock('../../services/emailService', () => ({
  emailService: { sendNfseEmail: vi.fn(), sendBoletoEmail: vi.fn() },
}));
vi.mock('../../controllers/fiscalController', () => ({
  emitNfseCore: vi.fn(),
}));

import { getSupabaseUserClient, supabaseAdmin } from '../../config/supabase';
import { installFakeSupabase } from '../helpers/mockSupabaseConfig';
import asaasWebhookRoutes from '../../routes/asaasWebhookRoutes';
import type { FakeSupabaseDb } from '../helpers/fakeSupabase';

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN!;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', asaasWebhookRoutes);
  return app;
}

describe('POST /api/webhooks/asaas', () => {
  let db: FakeSupabaseDb;
  const app = buildApp();

  beforeEach(() => {
    db = installFakeSupabase({ getSupabaseUserClient, supabaseAdmin });
  });

  it('403 sem o header asaas-access-token', async () => {
    const res = await request(app).post('/api/webhooks/asaas').send({ id: 'evt_1', event: 'PAYMENT_RECEIVED' });
    expect(res.status).toBe(403);
  });

  it('403 com token incorreto', async () => {
    const res = await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', 'token-errado')
      .send({ id: 'evt_1', event: 'PAYMENT_RECEIVED' });
    expect(res.status).toBe(403);
  });

  it('200 e loga o evento mesmo quando não há payment/invoice local correspondente', async () => {
    const res = await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_desconhecido', status: 'RECEIVED' } });

    expect(res.status).toBe(200);
    const log = db.getTable('asaas_webhook_logs').find((l) => l.event_id === 'evt_1')!;
    expect(log).toBeDefined();
    expect(log.processed).toBe(false); // markPaymentAsPaid não achou o payment local -> não marca processed
  });

  it('reentrega do mesmo event_id (23505) ainda responde 200, sem duplicar o log', async () => {
    db.seed('asaas_webhook_logs', [{ event_id: 'evt_dup', event_type: 'PAYMENT_RECEIVED', payment_id: 'pay_1', processed: true }]);
    // Simula a constraint unique(event_id) do Postgres rejeitando a reinserção.
    db.forceNextError('asaas_webhook_logs', 'insert', { code: '23505', message: 'duplicate key' });

    const res = await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ id: 'evt_dup', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED' } });

    expect(res.status).toBe(200);
    expect(db.getTable('asaas_webhook_logs')).toHaveLength(1);
  });

  it('evento não mapeado (nem PAYMENT_* nem INVOICE_*) só loga, sem processar nada', async () => {
    const res = await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ id: 'evt_x', event: 'CUSTOMER_UPDATED' });

    expect(res.status).toBe(200);
    const log = db.getTable('asaas_webhook_logs').find((l) => l.event_id === 'evt_x')!;
    expect(log.processed).toBe(false);
  });

  it('achado documentado: erro no processamento não derruba o 200, mas o log fica processed=false (sinal de atenção manual)', async () => {
    db.seed('payments', [{ id: 'p1', invoice_id: 'inv-1', client_id: 'c1', due_date: '2026-08-25', asaas_payment_id: 'pay_erro', net_value_projected: 1000 }]);
    // Força um erro direto no update de payments pra simular uma falha de processamento real.
    db.forceNextError('payments', 'update', { message: 'falha simulada de rede' });

    const res = await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ id: 'evt_erro', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_erro', status: 'CONFIRMED' } });

    expect(res.status).toBe(200); // nunca deixa o Asaas reentregar em loop
    const log = db.getTable('asaas_webhook_logs').find((l) => l.event_id === 'evt_erro')!;
    expect(log.processed).toBe(false); // único sinal de que precisa de atenção manual
  });
});
