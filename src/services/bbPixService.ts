import axios, { AxiosInstance } from 'axios';
import { BbOAuthTokenResponse, BbPixDestination, BbPixTransferRequest, BbPixTransferResponse, BbPixTransferResult } from '../types/bb';

const BB_BASE_URL = process.env.BB_BASE_URL || 'https://api.hm.bb.com.br';
const BB_OAUTH_URL = process.env.BB_OAUTH_URL || 'https://oauth.hm.bb.com.br/oauth/token';

interface TransferParams {
  paymentId: string;
  value: number;
  destination: BbPixDestination;
}

class BbPixService {
  private http: AxiosInstance;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor() {
    this.http = axios.create({
      baseURL: BB_BASE_URL,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // OAuth2 client_credentials. Best-effort: caminho/escopo/nome do header
  // gw-dev-app-key não confirmados contra a doc oficial do Developers BB —
  // validar antes de habilitar ENABLE_BB_PIX_TRANSFER=true.
  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }

    const clientId = process.env.BB_CLIENT_ID;
    const clientSecret = process.env.BB_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('BB_CLIENT_ID/BB_CLIENT_SECRET não configurados');

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const { data } = await axios.post<BbOAuthTokenResponse>(
      BB_OAUTH_URL,
      'grant_type=client_credentials&scope=pix.pagamentos-requisicao',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
        },
      }
    );

    // Margem de 60s pra evitar usar um token que expira no meio de uma chamada.
    this.cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  }

  // Transfere o valor líquido de um pagamento pra conta do BB da locadora.
  // Enquanto ENABLE_BB_PIX_TRANSFER !== 'true', não chama o BB — só loga o
  // payload que seria enviado e devolve um resultado simulado, pra permitir
  // testar o fluxo completo do webhook sem mover dinheiro real.
  async transferNetValueToBB({ paymentId, value, destination }: TransferParams): Promise<BbPixTransferResult> {
    const request: BbPixTransferRequest = {
      valor: value,
      chave: destination.pixKey ?? undefined,
      descricao: `Repasse locação RentDesk - payment ${paymentId}`,
      identificadorExterno: paymentId,
    };

    if (process.env.ENABLE_BB_PIX_TRANSFER !== 'true') {
      console.log('[bbPixService.transferNetValueToBB] SIMULADO (ENABLE_BB_PIX_TRANSFER=false) - payload que seria enviado ao BB:', {
        request,
        destination,
      });
      return { simulated: true, endToEndId: null, transferDate: null, raw: null };
    }

    const appKey = process.env.BB_APP_KEY;
    if (!appKey) throw new Error('BB_APP_KEY não configurado');

    const token = await this.getAccessToken();

    // Caminho best-effort (/pix/v1/pix) - validar contra a doc oficial do
    // Developers BB antes de confiar nisso em producao.
    const { data } = await this.http.post<BbPixTransferResponse>(
      '/pix/v1/pix',
      request,
      {
        params: { 'gw-dev-app-key': appKey },
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    return {
      simulated: false,
      endToEndId: data.endToEndId,
      transferDate: data.dataTransferencia,
      raw: data as unknown as Record<string, unknown>,
    };
  }
}

export const bbPixService = new BbPixService();
