import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockHttp, mockGetToken } = vi.hoisted(() => ({
  mockHttp: { post: vi.fn() },
  mockGetToken: vi.fn(),
}));
vi.mock('axios', () => ({ default: { create: vi.fn(() => mockHttp) } }));
vi.mock('../../services/bbAuthService', () => ({ getBbAccessToken: mockGetToken }));

describe('bbPixService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    mockHttp.post.mockReset();
    mockGetToken.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('modo simulado (ENABLE_BB_PIX_TRANSFER != true): não chama o BB, devolve endToEndId null', async () => {
    process.env.ENABLE_BB_PIX_TRANSFER = 'false';
    const { bbPixService } = await import('../../services/bbPixService');

    const result = await bbPixService.transferNetValueToBB({
      paymentId: 'payment-1',
      value: 1000,
      destination: { pixKey: 'chave@pix.com', bankCode: null, agency: null, account: null },
    });

    expect(result).toEqual({ simulated: true, endToEndId: null, transferDate: null, raw: null });
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it('modo real: chama o BB com o token do scope pix.pagamentos-requisicao e devolve o endToEndId', async () => {
    process.env.ENABLE_BB_PIX_TRANSFER = 'true';
    process.env.BB_APP_KEY = 'app-key';
    mockGetToken.mockResolvedValue('token-pix');
    mockHttp.post.mockResolvedValue({ data: { endToEndId: 'E123', dataTransferencia: '2026-08-20' } });

    const { bbPixService } = await import('../../services/bbPixService');
    const result = await bbPixService.transferNetValueToBB({
      paymentId: 'payment-1',
      value: 1000,
      destination: { pixKey: 'chave@pix.com', bankCode: null, agency: null, account: null },
    });

    expect(result.simulated).toBe(false);
    expect(result.endToEndId).toBe('E123');
    expect(mockGetToken).toHaveBeenCalledWith('pix.pagamentos-requisicao');
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/pix/v1/pix',
      expect.objectContaining({ valor: 1000, chave: 'chave@pix.com', identificadorExterno: 'payment-1' }),
      expect.objectContaining({ params: { 'gw-dev-app-key': 'app-key' } })
    );
  });

  it('modo real sem BB_APP_KEY configurado: lança erro claro antes de chamar o BB', async () => {
    process.env.ENABLE_BB_PIX_TRANSFER = 'true';
    delete process.env.BB_APP_KEY;
    const { bbPixService } = await import('../../services/bbPixService');

    await expect(
      bbPixService.transferNetValueToBB({ paymentId: 'p1', value: 100, destination: {} as any })
    ).rejects.toThrow(/BB_APP_KEY/);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });
});
