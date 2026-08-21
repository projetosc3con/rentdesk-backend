import axios, { AxiosInstance } from 'axios';
import {
  AsaasCustomerRequest, AsaasCustomerResponse,
  AsaasChargeRequest, AsaasPaymentResponse,
  AsaasReceiveInCashRequest, AsaasReceiveInCashResponse,
  AsaasInvoiceRequest, AsaasInvoiceResponse,
  AsaasTransferRequest, AsaasTransferResponse,
} from '../types/asaas';

const ASAAS_BASE_URL = process.env.ASAAS_BASE_URL || 'https://api-sandbox.asaas.com';
const ASAAS_USER_AGENT = process.env.ASAAS_USER_AGENT || 'RentDesk/1.0.0';

class AsaasService {
  private http: AxiosInstance;

  constructor() {
    // Sem access_token default: cada locadora tem sua própria chave (conta
    // principal), injetada por chamada.
    this.http = axios.create({
      baseURL: ASAAS_BASE_URL,
      headers: { 'User-Agent': ASAAS_USER_AGENT, 'Content-Type': 'application/json' },
    });
  }

  private authHeaders(apiKey: string) {
    return { headers: { access_token: apiKey } };
  }

  async createCustomer(apiKey: string, data: AsaasCustomerRequest): Promise<AsaasCustomerResponse> {
    const { data: response } = await this.http.post<AsaasCustomerResponse>(
      '/v3/customers', data, this.authHeaders(apiKey)
    );
    return response;
  }

  async getCustomer(apiKey: string, customerId: string): Promise<AsaasCustomerResponse> {
    const { data: response } = await this.http.get<AsaasCustomerResponse>(
      `/v3/customers/${customerId}`, this.authHeaders(apiKey)
    );
    return response;
  }

  async createCharge(apiKey: string, data: AsaasChargeRequest): Promise<AsaasPaymentResponse> {
    const { data: response } = await this.http.post<AsaasPaymentResponse>(
      '/v3/payments', data, this.authHeaders(apiKey)
    );
    return response;
  }

  async getPayment(apiKey: string, paymentId: string): Promise<AsaasPaymentResponse> {
    const { data: response } = await this.http.get<AsaasPaymentResponse>(
      `/v3/payments/${paymentId}`, this.authHeaders(apiKey)
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

  async createInvoice(apiKey: string, data: AsaasInvoiceRequest): Promise<AsaasInvoiceResponse> {
    const { data: response } = await this.http.post<AsaasInvoiceResponse>(
      '/v3/invoices', data, this.authHeaders(apiKey)
    );
    return response;
  }

  async getInvoice(apiKey: string, invoiceId: string): Promise<AsaasInvoiceResponse> {
    const { data: response } = await this.http.get<AsaasInvoiceResponse>(
      `/v3/invoices/${invoiceId}`, this.authHeaders(apiKey)
    );
    return response;
  }

  // Transfere saldo da conta Asaas pra uma chave Pix externa — é essa chamada
  // (e não nenhuma API do BB) que efetivamente move o valor recebido pra fora
  // do Asaas. A resposta costuma vir com status PENDING/BANK_PROCESSING, não
  // DONE — o resultado final chega depois via webhook (evento TRANSFER_DONE/
  // TRANSFER_FAILED, ver asaasWebhookController.handleTransferEvent).
  async createTransfer(apiKey: string, data: AsaasTransferRequest): Promise<AsaasTransferResponse> {
    const { data: response } = await this.http.post<AsaasTransferResponse>(
      '/v3/transfers', data, this.authHeaders(apiKey)
    );
    return response;
  }
}

export const asaasService = new AsaasService();
