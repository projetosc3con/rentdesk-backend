import axios, { AxiosInstance } from 'axios';
import {
  AsaasSubaccountRequest, AsaasSubaccountResponse,
  AsaasCustomerRequest, AsaasCustomerResponse,
  AsaasChargeRequest, AsaasPaymentResponse,
  AsaasReceiveInCashRequest, AsaasReceiveInCashResponse,
} from '../types/asaas';

const ASAAS_BASE_URL = process.env.ASAAS_BASE_URL || 'https://api-sandbox.asaas.com';
const ASAAS_USER_AGENT = process.env.ASAAS_USER_AGENT || 'RentDesk/1.0.0';

class AsaasService {
  private http: AxiosInstance;

  constructor() {
    // Sem access_token default: cada locadora tem sua própria chave de
    // subconta, injetada por chamada (exceto createSubaccount).
    this.http = axios.create({
      baseURL: ASAAS_BASE_URL,
      headers: { 'User-Agent': ASAAS_USER_AGENT, 'Content-Type': 'application/json' },
    });
  }

  private authHeaders(apiKey: string) {
    return { headers: { access_token: apiKey } };
  }

  async createSubaccount(data: AsaasSubaccountRequest): Promise<AsaasSubaccountResponse> {
    const masterKey = process.env.ASAAS_MASTER_API_KEY;
    if (!masterKey) throw new Error('ASAAS_MASTER_API_KEY is not configured');
    const { data: response } = await this.http.post<AsaasSubaccountResponse>(
      '/v3/accounts', data, this.authHeaders(masterKey)
    );
    return response;
  }

  async createCustomer(apiKey: string, data: AsaasCustomerRequest): Promise<AsaasCustomerResponse> {
    const { data: response } = await this.http.post<AsaasCustomerResponse>(
      '/v3/customers', data, this.authHeaders(apiKey)
    );
    return response;
  }

  async createCharge(apiKey: string, data: AsaasChargeRequest): Promise<AsaasPaymentResponse> {
    const { data: response } = await this.http.post<AsaasPaymentResponse>(
      '/v3/payments', data, this.authHeaders(apiKey)
    );
    return response;
  }

  async receiveInCash(
    apiKey: string, paymentId: string, data: AsaasReceiveInCashRequest
  ): Promise<AsaasReceiveInCashResponse> {
    // Não credita saldo no Asaas — só marca a cobrança como paga fora da
    // plataforma. Se houver negativação ativa, pode gerar taxa de ativação
    // (receivedInCashFeeValue) — não tratado aqui.
    const { data: response } = await this.http.post<AsaasReceiveInCashResponse>(
      `/v3/payments/${paymentId}/receiveInCash`, data, this.authHeaders(apiKey)
    );
    return response;
  }
}

export const asaasService = new AsaasService();
