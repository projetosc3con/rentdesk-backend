import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../config/supabase', () => ({
  getSupabaseUserClient: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
  supabase: {},
}));

import { getSupabaseUserClient, supabaseAdmin } from '../../config/supabase';
import { installFakeSupabase } from '../helpers/mockSupabaseConfig';
import { buildTestApp, profileHeader } from '../helpers/testApp';
import { makeBill, makePayment, makeInvoice, makeClient } from '../helpers/fixtures';
import billRoutes from '../../routes/billRoutes';
import type { FakeSupabaseDb } from '../helpers/fakeSupabase';

describe('billRoutes', () => {
  let db: FakeSupabaseDb;
  const app = buildTestApp(billRoutes, '/api/bills');

  beforeEach(() => {
    db = installFakeSupabase({ getSupabaseUserClient, supabaseAdmin });
  });

  describe('GET /api/bills', () => {
    it('nega acesso sem role liberada', async () => {
      const res = await request(app).get('/api/bills').set('x-test-profile', profileHeader('Comercial'));
      expect(res.status).toBe(403);
    });

    it('mescla bills + payments pendentes quando não há filtro (merge completo)', async () => {
      const invoice = makeInvoice();
      const client = makeClient();
      const reconciledPayment = makePayment({ client_id: client.id });
      const pendingPayment = makePayment({ client_id: client.id, due_date: '2026-08-10' });
      const bill = makeBill({
        origin: 'ASAAS',
        payment_id: reconciledPayment.id,
        client_id: client.id,
        rental_invoice_id: invoice.id,
        due_date: '2026-08-15',
      });

      db.seed('rental_invoices', [invoice]);
      db.seed('clients', [client]);
      db.seed('payments', [reconciledPayment, pendingPayment]);
      db.seed('bills', [bill]);

      const res = await request(app).get('/api/bills').set('x-test-profile', profileHeader('Administrador'));

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      const ids = res.body.data.map((item: any) => item.id);
      expect(ids).toContain(bill.id);
      expect(ids).toContain(pendingPayment.id);
      // O payment já reconciliado (tem bill correspondente) não deve aparecer solto.
      expect(ids).not.toContain(reconciledPayment.id);
    });

    it('com filtro (ex: unreconciled=true) devolve array puro sem paginação nem payments pendentes', async () => {
      const unreconciled = makeBill({ bank_transaction_date: null });
      const reconciled = makeBill({ bank_transaction_date: '2026-08-01', status: 'Recebido' });
      db.seed('bills', [unreconciled, reconciled]);
      db.seed('payments', [makePayment()]);

      const res = await request(app)
        .get('/api/bills?unreconciled=true')
        .set('x-test-profile', profileHeader('Administrador'));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(unreconciled.id);
    });
  });

  describe('POST /api/bills', () => {
    it('valida campos obrigatórios', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('x-test-profile', profileHeader('Administrador'))
        .send({ type: 'invalid' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/type deve ser/);
    });

    it('cria um lançamento manual pendente', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('x-test-profile', profileHeader('Administrador'))
        .send({ type: 'payable', counterparty_name: 'Fornecedor X', gross_value: 250, due_date: '2026-09-01' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('Pendente');
      expect(res.body.origin).toBe('MANUAL');
      expect(db.getTable('bills')).toHaveLength(1);
    });

    it('marca já quitado (already_settled) como Recebido', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('x-test-profile', profileHeader('Administrador'))
        .send({
          type: 'receivable',
          gross_value: 100,
          due_date: '2026-09-01',
          already_settled: true,
          settled_date: '2026-08-15',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('Recebido');
    });
  });
});
