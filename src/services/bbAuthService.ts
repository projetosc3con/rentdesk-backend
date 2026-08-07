import axios from 'axios';
import type { Agent } from 'https';
import { BbOAuthTokenResponse } from '../types/bb';

const BB_OAUTH_URL = process.env.BB_OAUTH_URL || 'https://oauth.hm.bb.com.br/oauth/token';

// Cache de token por scope — cada produto BB (Pix, Extrato, ...) tem seu
// próprio scope OAuth, então cada um precisa do seu próprio token.
const tokenCache = new Map<string, { value: string; expiresAt: number }>();

// OAuth2 client_credentials, compartilhado por todos os serviços BB. Best-effort:
// caminho/escopo/nome do header gw-dev-app-key não confirmados contra a doc
// oficial do Developers BB — validar antes de habilitar qualquer flag
// ENABLE_BB_*_FETCH/TRANSFER=true em produção.
//
// `httpsAgent` é opcional porque ainda não confirmamos empiricamente se o
// endpoint OAuth do BB também exige mTLS ou só os hosts de produto (ex.:
// extratos.mtls.api.*.bb.com.br) exigem — passar o agent aqui é só pra quem
// for testar as duas hipóteses (ver scripts/testBbExtrato.ts, Fase B).
export async function getBbAccessToken(scope: string, httpsAgent?: Agent): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const clientId = process.env.BB_CLIENT_ID;
  const clientSecret = process.env.BB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('BB_CLIENT_ID/BB_CLIENT_SECRET não configurados');

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const { data } = await axios.post<BbOAuthTokenResponse>(
    BB_OAUTH_URL,
    `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
    {
      httpsAgent,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
    }
  );

  // Margem de 60s pra evitar usar um token que expira no meio de uma chamada.
  tokenCache.set(scope, { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 });
  return data.access_token;
}
