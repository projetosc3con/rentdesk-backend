import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../config/supabase', () => ({
  getSupabaseUserClient: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
  supabase: {},
}));
vi.mock('../../services/asaasService', () => ({
  asaasService: { createCustomer: vi.fn(), getCustomer: vi.fn() },
}));

import { getSupabaseUserClient, supabaseAdmin } from '../../config/supabase';
import { asaasService } from '../../services/asaasService';
import { installFakeSupabase } from '../helpers/mockSupabaseConfig';
import { buildTestApp, profileHeader } from '../helpers/testApp';
import { makeClient, makeSettings } from '../helpers/fixtures';
import clientRoutes from '../../routes/clientRoutes';
import type { FakeSupabaseDb } from '../helpers/fakeSupabase';

describe('clientRoutes — integração Asaas', () => {
  let db: FakeSupabaseDb;
  const app = buildTestApp(clientRoutes, '/api/clients');

  beforeEach(() => {
    db = installFakeSupabase({ getSupabaseUserClient, supabaseAdmin });
    vi.mocked(asaasService.createCustomer).mockReset();
    vi.mocked(asaasService.getCustomer).mockReset();
  });

  describe('POST /:id/asaas-sync', () => {
    it('nega acesso pra role fora do conjunto liberado (Comercial não está em Administrador/Diretoria/Gerente/Financeiro)', async () => {
      const client = makeClient({ asaas_customer_id: null });
      db.seed('clients', [client]);
      const res = await request(app)
        .post(`/api/clients/${client.id}/asaas-sync`)
        .set('x-test-profile', profileHeader('Comercial'));
      expect(res.status).toBe(403);
    });

    it('404 quando o cliente não existe', async () => {
      const res = await request(app)
        .post('/api/clients/nao-existe/asaas-sync')
        .set('x-test-profile', profileHeader('Financeiro'));
      expect(res.status).toBe(404);
    });

    it('cria o customer no Asaas e persiste asaas_customer_id (role Financeiro: ler e alterar)', async () => {
      const client = makeClient({ asaas_customer_id: null });
      db.seed('clients', [client]);
      db.seed('erp_company_settings', [makeSettings()]);
      vi.mocked(asaasService.createCustomer).mockResolvedValue({ id: 'cus_novo' } as any);

      const res = await request(app)
        .post(`/api/clients/${client.id}/asaas-sync`)
        .set('x-test-profile', profileHeader('Financeiro'));

      expect(res.status).toBe(200);
      expect(res.body.asaas_customer_id).toBe('cus_novo');
    });
  });

  describe('GET /:id/asaas-verify', () => {
    it('nega acesso sem role liberada', async () => {
      const client = makeClient({ asaas_customer_id: 'cus_1' });
      db.seed('clients', [client]);
      const res = await request(app)
        .get(`/api/clients/${client.id}/asaas-verify`)
        .set('x-test-profile', profileHeader('Comercial'));
      expect(res.status).toBe(403);
    });

    it('400 quando o cliente ainda não foi sincronizado', async () => {
      const client = makeClient({ asaas_customer_id: null });
      db.seed('clients', [client]);
      const res = await request(app)
        .get(`/api/clients/${client.id}/asaas-verify`)
        .set('x-test-profile', profileHeader('Administrador'));
      expect(res.status).toBe(400);
    });

    it('devolve os dados do customer no Asaas', async () => {
      const client = makeClient({ asaas_customer_id: 'cus_1' });
      db.seed('clients', [client]);
      db.seed('erp_company_settings', [makeSettings()]);
      vi.mocked(asaasService.getCustomer).mockResolvedValue({ id: 'cus_1', name: 'Cliente Teste' } as any);

      const res = await request(app)
        .get(`/api/clients/${client.id}/asaas-verify`)
        .set('x-test-profile', profileHeader('Administrador'));

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('cus_1');
    });

    it('libera Financeiro também (ler)', async () => {
      const client = makeClient({ asaas_customer_id: 'cus_1' });
      db.seed('clients', [client]);
      db.seed('erp_company_settings', [makeSettings()]);
      vi.mocked(asaasService.getCustomer).mockResolvedValue({ id: 'cus_1' } as any);

      const res = await request(app)
        .get(`/api/clients/${client.id}/asaas-verify`)
        .set('x-test-profile', profileHeader('Financeiro'));

      expect(res.status).toBe(200);
    });
  });
});
