import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));
vi.mock('axios', () => ({ default: { post: mockPost } }));

describe('bbAuthService — cache de token por scope', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    mockPost.mockReset();
    process.env = { ...originalEnv, BB_CLIENT_ID: 'client-id', BB_CLIENT_SECRET: 'client-secret' };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reutiliza o token em cache dentro da validade, sem nova chamada HTTP', async () => {
    mockPost.mockResolvedValue({ data: { access_token: 'token-A', expires_in: 3600 } });
    const { getBbAccessToken } = await import('../../services/bbAuthService');

    const first = await getBbAccessToken('extrato-info');
    const second = await getBbAccessToken('extrato-info');

    expect(first).toBe('token-A');
    expect(second).toBe('token-A');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('busca um token novo quando o cache expirou', async () => {
    mockPost
      .mockResolvedValueOnce({ data: { access_token: 'token-A', expires_in: -1 } }) // já expira na hora (margem de 60s deixa negativo)
      .mockResolvedValueOnce({ data: { access_token: 'token-B', expires_in: 3600 } });
    const { getBbAccessToken } = await import('../../services/bbAuthService');

    const first = await getBbAccessToken('extrato-info');
    const second = await getBbAccessToken('extrato-info');

    expect(first).toBe('token-A');
    expect(second).toBe('token-B');
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('mantém caches independentes por scope (Pix vs Extrato)', async () => {
    mockPost
      .mockResolvedValueOnce({ data: { access_token: 'token-extrato', expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { access_token: 'token-pix', expires_in: 3600 } });
    const { getBbAccessToken } = await import('../../services/bbAuthService');

    const extrato = await getBbAccessToken('extrato-info');
    const pix = await getBbAccessToken('pix.pagamentos-requisicao');

    expect(extrato).toBe('token-extrato');
    expect(pix).toBe('token-pix');
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('lança erro claro quando BB_CLIENT_ID/SECRET não estão configurados', async () => {
    delete process.env.BB_CLIENT_ID;
    delete process.env.BB_CLIENT_SECRET;
    const { getBbAccessToken } = await import('../../services/bbAuthService');

    await expect(getBbAccessToken('extrato-info')).rejects.toThrow(/BB_CLIENT_ID/);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
