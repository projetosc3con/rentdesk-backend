import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../config/supabase', () => ({
  getSupabaseUserClient: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
  supabase: {},
}));

import { getSupabaseUserClient, supabaseAdmin } from '../../config/supabase';
import { installFakeSupabase } from '../helpers/mockSupabaseConfig';
import { makeBill } from '../helpers/fixtures';
import asaasWebhookRoutes from '../../routes/asaasWebhookRoutes';
import type { FakeSupabaseDb } from '../helpers/fakeSupabase';

const APPROVAL_TOKEN = process.env.ASAAS_TRANSFER_APPROVAL_TOKEN!;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', asaasWebhookRoutes);
  return app;
}

describe('POST /api/webhooks/asaas-transfer-approval', () => {
  let db: FakeSupabaseDb;
  const app = buildApp();

  beforeEach(() => {
    db = installFakeSupabase({ getSupabaseUserClient, supabaseAdmin });
  });

  it('403 sem o header asaas-access-token', async () => {
    const res = await request(app)
      .post('/api/webhooks/asaas-transfer-approval')
      .send({ type: 'TRANSFER', transfer: { id: 'transf_1' } });
    expect(res.status).toBe(403);
  });

  it('403 com token incorreto', async () => {
    const res = await request(app)
      .post('/api/webhooks/asaas-transfer-approval')
      .set('asaas-access-token', 'token-errado')
      .send({ type: 'TRANSFER', transfer: { id: 'transf_1' } });
    expect(res.status).toBe(403);
  });

  it('REFUSED pra tipo de operação diferente de TRANSFER (não iniciamos BILL/PIX_QR_CODE/etc)', async () => {
    const res = await request(app)
      .post('/api/webhooks/asaas-transfer-approval')
      .set('asaas-access-token', APPROVAL_TOKEN)
      .send({ type: 'PIX_QR_CODE' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REFUSED');
  });

  it('REFUSED quando o id da transferência não corresponde a nenhum bill local', async () => {
    const res = await request(app)
      .post('/api/webhooks/asaas-transfer-approval')
      .set('asaas-access-token', APPROVAL_TOKEN)
      .send({ type: 'TRANSFER', transfer: { id: 'transf_desconhecida', status: 'PENDING', value: 100 } });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REFUSED');
  });

  it('APPROVED quando o id da transferência bate com um bill que nós criamos', async () => {
    const bill = makeBill({ asaas_transfer_id: 'transf_reconhecida' });
    db.seed('bills', [bill]);

    const res = await request(app)
      .post('/api/webhooks/asaas-transfer-approval')
      .set('asaas-access-token', APPROVAL_TOKEN)
      .send({ type: 'TRANSFER', transfer: { id: 'transf_reconhecida', status: 'PENDING', value: 100 } });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
  });
});
