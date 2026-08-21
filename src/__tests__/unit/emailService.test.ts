import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockHttp } = vi.hoisted(() => ({ mockHttp: { post: vi.fn() } }));
vi.mock('axios', () => ({ default: { create: vi.fn(() => mockHttp) } }));

describe('emailService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    mockHttp.post.mockReset().mockResolvedValue({ data: { id: 'email_1' } });
    process.env = { ...originalEnv, RESEND_API_KEY: 'test-resend-key' };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('sendBoletoEmail lança erro claro quando RESEND_API_KEY não está configurada', async () => {
    delete process.env.RESEND_API_KEY;
    const { emailService } = await import('../../services/emailService');

    await expect(
      emailService.sendBoletoEmail({
        to: 'cliente@example.com',
        clientName: 'Cliente X',
        companyName: 'C3Loc',
        totalValue: 100,
        dueDate: '2026-09-01',
        invoiceUrl: 'https://x',
      })
    ).rejects.toThrow(/RESEND_API_KEY/);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it('sendBoletoEmail envia pro destinatário real quando informado (sem EMAIL_TEST_OVERRIDE)', async () => {
    const { emailService } = await import('../../services/emailService');

    await emailService.sendBoletoEmail({
      to: 'cliente@example.com',
      clientName: 'Cliente X',
      companyName: 'C3Loc',
      totalValue: 1234.5,
      dueDate: '2026-09-01',
      invoiceUrl: 'https://asaas.test/i/1',
    });

    expect(mockHttp.post).toHaveBeenCalledOnce();
    const [path, payload, config] = mockHttp.post.mock.calls[0];
    expect(path).toBe('/emails');
    expect(payload.to).toEqual(['cliente@example.com']);
    expect(payload.html).toContain('R$'); // formatCurrency aplicado no template
    expect(payload.html).toContain('01/09/2026'); // formatDate aplicado no template
    expect(config.headers.Authorization).toBe('Bearer test-resend-key');
  });

  it('EMAIL_TEST_OVERRIDE redireciona o envio mesmo com um destinatário real informado', async () => {
    process.env.EMAIL_TEST_OVERRIDE = 'override@example.com';
    const { emailService } = await import('../../services/emailService');

    await emailService.sendNfseEmail({
      to: '', // sem e-mail real do cliente
      clientName: 'Cliente X',
      companyName: 'C3Loc',
      equipmentDescription: 'Guindaste',
      nfseLink: 'https://asaas.test/nfse.pdf',
    });

    const [, payload] = mockHttp.post.mock.calls[0];
    expect(payload.to).toEqual(['override@example.com']);
  });

  it('sendContractEmail anexa o PDF em base64 quando fornecido', async () => {
    const { emailService } = await import('../../services/emailService');

    await emailService.sendContractEmail({
      to: 'cliente@example.com',
      contactName: 'Cliente X',
      companyName: 'C3Loc',
      contractNumber: 'CT-001',
      equipmentDescription: 'Guindaste',
      totalValue: 5000,
      downloadUrl: 'https://x/contrato',
      pdfBase64: 'base64conteudo',
      pdfFilename: 'contrato.pdf',
    });

    const [, payload] = mockHttp.post.mock.calls[0];
    expect(payload.attachments).toEqual([{ filename: 'contrato.pdf', content: 'base64conteudo' }]);
  });

  it('sendSignedContractNotification não chama a API quando a lista de destinatários está vazia', async () => {
    const { emailService } = await import('../../services/emailService');
    delete process.env.EMAIL_TEST_OVERRIDE;

    await emailService.sendSignedContractNotification({
      to: [],
      clientName: 'Cliente X',
      contractNumber: 'CT-001',
      equipmentDescription: 'Guindaste',
      dealTitle: 'Negociação X',
      signedFileUrl: 'https://x/assinado',
    });

    expect(mockHttp.post).not.toHaveBeenCalled();
  });
});
