// Tipos best-effort para a API do Banco do Brasil (Developers BB, ambiente
// homologação). Nenhum destes shapes foi validado contra a doc oficial —
// confirmar campo a campo antes de setar ENABLE_BB_PIX_TRANSFER=true.
// Mesma ressalva já usada em src/types/asaas.ts para os shapes best-effort.

// --- OAuth2 (client_credentials) ---
export interface BbOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // segundos
  scope: string;
}

// --- Dados bancários de destino (origem: erp_company_settings) ---
export interface BbPixDestination {
  bankCode: string | null;
  agency: string | null;
  account: string | null;
  pixKey: string | null;
}

// --- Transferência PIX — payload de saída (best-effort) ---
export interface BbPixTransferRequest {
  valor: number;
  chave?: string; // chave PIX do favorecido, quando disponível
  descricao?: string;
  identificadorExterno?: string; // sugestão: payments.id, pra rastrear/idempotência do lado do BB
}

// --- Transferência PIX — resposta (best-effort) ---
export interface BbPixTransferResponse {
  endToEndId: string; // identificador único do PIX — chave de conciliação com o extrato
  dataTransferencia: string; // YYYY-MM-DD
  status: string;
}

// Resultado normalizado devolvido por bbPixService.transferNetValueToBB,
// unificando o caminho real e o caminho simulado (ENABLE_BB_PIX_TRANSFER=false).
export interface BbPixTransferResult {
  simulated: boolean;
  endToEndId: string | null;
  transferDate: string | null;
  raw: Record<string, unknown> | null;
}
