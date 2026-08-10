import axios, { AxiosInstance } from 'axios';
import { BbPixDestination, BbPixTransferRequest, BbPixTransferResponse, BbPixTransferResult } from '../types/bb';
import { getBbAccessToken } from './bbAuthService';

const BB_BASE_URL = process.env.BB_BASE_URL || 'https://api.hm.bb.com.br';
const BB_PIX_SCOPE = 'pix.pagamentos-requisicao';

interface TransferParams {
  paymentId: string;
  value: number;
  destination: BbPixDestination;
}

class BbPixService {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: BB_BASE_URL,
      headers: { 'Content-Type': 'application/json' },
    });
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

    const token = await getBbAccessToken(BB_PIX_SCOPE);

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
