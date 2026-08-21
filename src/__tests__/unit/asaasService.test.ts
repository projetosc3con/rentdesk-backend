import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHttp } = vi.hoisted(() => ({ mockHttp: { post: vi.fn(), get: vi.fn() } }));
vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockHttp) },
}));

import { asaasService } from '../../services/asaasService';

describe('asaasService', () => {
  beforeEach(() => {
    mockHttp.post.mockReset();
    mockHttp.get.mockReset();
  });

  it('createCharge envia o apiKey no header access_token e devolve o payment criado', async () => {
    mockHttp.post.mockResolvedValue({ data: { id: 'pay_1', status: 'PENDING' } });

    const result = await asaasService.createCharge('minha-key', {
      customer: 'cus_1',
      billingType: 'BOLETO',
      value: 100,
      dueDate: '2026-09-01',
      description: 'teste',
    } as any);

    expect(result).toEqual({ id: 'pay_1', status: 'PENDING' });
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/v3/payments',
      expect.objectContaining({ customer: 'cus_1' }),
      { headers: { access_token: 'minha-key' } }
    );
  });

  it('createCustomer chama /v3/customers', async () => {
    mockHttp.post.mockResolvedValue({ data: { id: 'cus_1' } });
    const result = await asaasService.createCustomer('key', { name: 'Cliente X', cpfCnpj: '000' } as any);
    expect(result.id).toBe('cus_1');
    expect(mockHttp.post).toHaveBeenCalledWith('/v3/customers', expect.anything(), expect.anything());
  });

  it('getPayment busca por id via GET', async () => {
    mockHttp.get.mockResolvedValue({ data: { id: 'pay_1', status: 'RECEIVED' } });
    const result = await asaasService.getPayment('key', 'pay_1');
    expect(result.status).toBe('RECEIVED');
    expect(mockHttp.get).toHaveBeenCalledWith('/v3/payments/pay_1', { headers: { access_token: 'key' } });
  });

  it('createInvoice chama /v3/invoices (usado pra emissão de NFS-e)', async () => {
    mockHttp.post.mockResolvedValue({ data: { id: 'inv_1', status: 'SCHEDULED' } });
    const result = await asaasService.createInvoice('key', { payment: 'pay_1', value: 100 } as any);
    expect(result.status).toBe('SCHEDULED');
    expect(mockHttp.post).toHaveBeenCalledWith('/v3/invoices', expect.anything(), expect.anything());
  });

  it('createTransfer chama /v3/transfers com a chave Pix e devolve o resultado (repasse do saldo Asaas)', async () => {
    mockHttp.post.mockResolvedValue({ data: { id: 'transf_1', status: 'PENDING', value: 500 } });

    const result = await asaasService.createTransfer('minha-key', {
      value: 500,
      pixAddressKey: 'chave@pix.com',
      pixAddressKeyType: 'EMAIL',
      externalReference: 'payment-1',
    });

    expect(result).toEqual({ id: 'transf_1', status: 'PENDING', value: 500 });
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/v3/transfers',
      expect.objectContaining({ pixAddressKey: 'chave@pix.com', pixAddressKeyType: 'EMAIL' }),
      { headers: { access_token: 'minha-key' } }
    );
  });

  it('propaga erro do axios sem engolir (ex: erro 400 da Asaas)', async () => {
    const error = Object.assign(new Error('Request failed'), { response: { status: 400, data: { errors: [{ description: 'valor inválido' }] } } });
    mockHttp.post.mockRejectedValue(error);
    await expect(asaasService.createCharge('key', {} as any)).rejects.toThrow('Request failed');
  });
});
