import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Fluxo integrado real: webhook -> baixa em payments -> bill -> emissão de
// NFS-e (emitNfseCore de verdade, não mockado) -> e-mail. Só as bordas
// externas (Asaas, Resend) são mockadas.
vi.mock('../../config/supabase', () => ({
  getSupabaseUserClient: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
  supabase: {},
}));
vi.mock('../../services/emailService', () => ({
  emailService: { sendNfseEmail: vi.fn(), sendBoletoEmail: vi.fn() },
}));
vi.mock('../../services/asaasService', () => ({
  asaasService: { createInvoice: vi.fn(), createTransfer: vi.fn() },
}));

import { getSupabaseUserClient, supabaseAdmin } from '../../config/supabase';
import { emailService } from '../../services/emailService';
import { asaasService } from '../../services/asaasService';
import { installFakeSupabase } from '../helpers/mockSupabaseConfig';
import { makeInvoice, makeClient, makeSettings } from '../helpers/fixtures';
import asaasWebhookRoutes from '../../routes/asaasWebhookRoutes';
import type { FakeSupabaseDb } from '../helpers/fakeSupabase';

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN!;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', asaasWebhookRoutes);
  return app;
}

describe('Fluxo integrado: webhook PAYMENT_RECEIVED -> bill -> NFS-e -> e-mail', () => {
  let db: FakeSupabaseDb;
  const app = buildApp();

  beforeEach(() => {
    db = installFakeSupabase({ getSupabaseUserClient, supabaseAdmin });
    vi.mocked(emailService.sendNfseEmail).mockReset().mockResolvedValue(undefined);
    vi.mocked(asaasService.createInvoice).mockReset();
    vi.mocked(asaasService.createTransfer).mockReset().mockResolvedValue({
      id: 'transf_1', status: 'PENDING', value: 1000,
    } as any);
  });

  function seedBaseFixtures() {
    const client = makeClient({ email: 'cliente@example.com' });
    const invoice = makeInvoice({ client_id: client.id, equipment_name: 'Guindaste', total_value: 1000 });
    const payment = {
      id: 'payment-1',
      invoice_id: invoice.id,
      client_id: client.id,
      due_date: invoice.due_date,
      net_value_projected: 1000,
      asaas_payment_id: 'pay_abc',
      status: 'PENDING',
    };
    db.seed('clients', [client]);
    db.seed('rental_invoices', [invoice]);
    db.seed('payments', [payment]);
    db.seed('erp_company_settings', [makeSettings({ bank_pix_key: 'chave@pix.com' })]);
    return { client, invoice, payment };
  }

  it('caminho completo: bill lançado (ainda não conciliado com o banco), NFS-e emitida; sem pdfUrl ainda -> e-mail aguarda INVOICE_AUTHORIZED', async () => {
    const { client, invoice, payment } = seedBaseFixtures();
    vi.mocked(asaasService.createInvoice).mockResolvedValue({
      id: 'inv_asaas_1',
      status: 'SCHEDULED',
      pdfUrl: null,
      xmlUrl: null,
    } as any);

    const res = await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({
        id: 'evt_full_1',
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_abc', status: 'RECEIVED', netValue: 1000, value: 1000, paymentDate: '2026-08-20' },
      });

    expect(res.status).toBe(200);

    const updatedPayment = db.getTable('payments').find((p) => p.id === payment.id)!;
    expect(updatedPayment.status).toBe('RECEIVED');
    expect(updatedPayment.net_value).toBe(1000);

    const bill = db.getTable('bills').find((b) => b.payment_id === payment.id)!;
    expect(bill).toBeDefined();
    expect(bill.origin).toBe('ASAAS');
    expect(bill.client_id).toBe(client.id);
    expect(bill.status).toBe('Recebido');
    // Repasse pedido ao Asaas (não ao BB) — resposta ainda PENDING, então o
    // bill guarda o id da transferência mas ainda não está conciliado com o
    // banco (isso só acontece no evento TRANSFER_DONE, testado abaixo).
    expect(bill.asaas_transfer_id).toBe('transf_1');
    expect(bill.pix_end_to_end_id).toBeNull();
    expect(bill.bank_transaction_date).toBeNull();
    expect(asaasService.createTransfer).toHaveBeenCalledWith(
      'test-asaas-key',
      expect.objectContaining({ value: 1000, pixAddressKey: 'chave@pix.com', pixAddressKeyType: 'EMAIL' })
    );

    const nfse = db.getTable('invoice_nfse').find((n) => n.invoice_id === invoice.id)!;
    expect(nfse.status).toBe('SCHEDULED');
    expect(emailService.sendNfseEmail).not.toHaveBeenCalled(); // sem pdfUrl ainda

    const log = db.getTable('asaas_webhook_logs').find((l) => l.event_id === 'evt_full_1')!;
    expect(log.processed).toBe(true);
  });

  it('quando o Asaas já devolve pdfUrl na criação, dispara o e-mail de NFS-e imediatamente', async () => {
    seedBaseFixtures();
    vi.mocked(asaasService.createInvoice).mockResolvedValue({
      id: 'inv_asaas_2',
      status: 'AUTHORIZED',
      pdfUrl: 'https://asaas.test/nfse.pdf',
      xmlUrl: 'https://asaas.test/nfse.xml',
    } as any);

    const res = await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({
        id: 'evt_full_2',
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_abc', status: 'RECEIVED', netValue: 1000, value: 1000 },
      });

    expect(res.status).toBe(200);
    expect(emailService.sendNfseEmail).toHaveBeenCalledOnce();
    expect(vi.mocked(emailService.sendNfseEmail).mock.calls[0][0]).toMatchObject({
      to: 'cliente@example.com',
      nfseLink: 'https://asaas.test/nfse.pdf',
    });
  });

  it('reentrega do mesmo pagamento (bill já existe) não gera uma segunda linha em bills', async () => {
    const { payment } = seedBaseFixtures();
    db.seed('bills', [{ id: 'bill-existente', payment_id: payment.id, origin: 'ASAAS', status: 'Recebido' }]);

    const res = await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({
        id: 'evt_retry',
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_abc', status: 'RECEIVED', netValue: 1000, value: 1000 },
      });

    expect(res.status).toBe(200);
    expect(db.getTable('bills').filter((b) => b.payment_id === payment.id)).toHaveLength(1);
  });

  it('achado documentado: falha só na emissão de NFS-e não desfaz a baixa nem o lançamento em bills já feitos, mas deixa o log processed=false', async () => {
    seedBaseFixtures();
    vi.mocked(asaasService.createInvoice).mockRejectedValue(new Error('Asaas fora do ar'));

    const res = await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({
        id: 'evt_full_falha_nfse',
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_abc', status: 'RECEIVED', netValue: 1000, value: 1000 },
      });

    expect(res.status).toBe(200);
    // Baixa e lançamento em bills já tinham acontecido antes da NFS-e falhar -> permanecem.
    const updatedPayment = db.getTable('payments').find((p) => p.asaas_payment_id === 'pay_abc')!;
    expect(updatedPayment.status).toBe('RECEIVED');
    expect(db.getTable('bills')).toHaveLength(1);
    // A falha da NFS-e impede o update final de processed=true.
    const log = db.getTable('asaas_webhook_logs').find((l) => l.event_id === 'evt_full_falha_nfse')!;
    expect(log.processed).toBe(false);
    const nfseError = db.getTable('invoice_nfse').find((n) => n.status === 'ERRO');
    expect(nfseError).toBeDefined();
  });

  it('evento TRANSFER_DONE conclui a conciliação do bill (pix_end_to_end_id + bank_transaction_date)', async () => {
    const { payment } = seedBaseFixtures();
    vi.mocked(asaasService.createInvoice).mockResolvedValue({ id: 'inv_1', status: 'SCHEDULED', pdfUrl: null, xmlUrl: null } as any);

    await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({
        id: 'evt_pay_transf',
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_abc', status: 'RECEIVED', netValue: 1000, value: 1000 },
      });

    const billBefore = db.getTable('bills').find((b) => b.payment_id === payment.id)!;
    expect(billBefore.asaas_transfer_id).toBe('transf_1');
    expect(billBefore.bank_transaction_date).toBeNull();

    const res = await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({
        id: 'evt_transfer_done',
        event: 'TRANSFER_DONE',
        transfer: { id: 'transf_1', status: 'DONE', value: 1000, effectiveDate: '2026-08-20', endToEndIdentifier: 'E00000000202608201200X1' },
      });

    expect(res.status).toBe(200);
    const billAfter = db.getTable('bills').find((b) => b.payment_id === payment.id)!;
    expect(billAfter.pix_end_to_end_id).toBe('E00000000202608201200X1');
    expect(billAfter.bank_transaction_date).toBe('2026-08-20');
    const log = db.getTable('asaas_webhook_logs').find((l) => l.event_id === 'evt_transfer_done')!;
    expect(log.processed).toBe(true);
  });

  it('achado documentado: falha ao pedir o repasse não impede a NFS-e nem derruba o webhook', async () => {
    seedBaseFixtures();
    vi.mocked(asaasService.createTransfer).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { errors: [{ description: 'saldo insuficiente' }] } } })
    );
    vi.mocked(asaasService.createInvoice).mockResolvedValue({ id: 'inv_1', status: 'SCHEDULED', pdfUrl: null, xmlUrl: null } as any);

    const res = await request(app)
      .post('/api/webhooks/asaas')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({
        id: 'evt_falha_repasse',
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_abc', status: 'RECEIVED', netValue: 1000, value: 1000 },
      });

    expect(res.status).toBe(200);
    const bill = db.getTable('bills')[0];
    expect(bill.asaas_transfer_id).toBeNull(); // pedido falhou, não chegou a gravar
    const nfse = db.getTable('invoice_nfse')[0];
    expect(nfse.status).toBe('SCHEDULED'); // NFS-e seguiu normalmente, sem bloqueio
    const log = db.getTable('asaas_webhook_logs').find((l) => l.event_id === 'evt_falha_repasse')!;
    expect(log.processed).toBe(true);
  });
});
