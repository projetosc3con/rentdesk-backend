import axios from 'axios';
import {
  SerasaLoginResponse, SerasaScoreRequest, SerasaScoreResponse, DocumentType,
} from '../types/serasa';

const SERASA_BASE_URL = process.env.SERASA_BASE_URL || 'https://uat-api.serasaexperian.com.br';
const SERASA_IAM_TOKEN = process.env.SERASA_IAM_TOKEN || '';
const SERASA_MODEL_PF = process.env.SERASA_MODEL_PF || '';
const SERASA_MODEL_PJ = process.env.SERASA_MODEL_PJ || '';

const http = axios.create({ baseURL: SERASA_BASE_URL });

// Cache em memória — válido enquanto o processo estiver no ar (single instance).
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

const login = async (): Promise<string> => {
  if (!SERASA_IAM_TOKEN) throw new Error('SERASA_IAM_TOKEN não configurado');

  const { data } = await http.post<SerasaLoginResponse>(
    '/security/iam/v1/client-identities/login',
    {},
    { headers: { Authorization: `Basic ${SERASA_IAM_TOKEN}` } }
  );

  const expiresInMs = Number(data.expiresIn) * 1000;
  // Margem de segurança de 60s antes do vencimento real do token.
  cachedToken = { accessToken: data.accessToken, expiresAt: Date.now() + expiresInMs - 60_000 };
  return cachedToken.accessToken;
};

const getAccessToken = async (): Promise<string> => {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }
  return login();
};

export const consultarScore = async (document: string, tipo: DocumentType): Promise<number> => {
  const model = tipo === 'PF' ? SERASA_MODEL_PF : SERASA_MODEL_PJ;
  if (!model) throw new Error(`Modelo Serasa não configurado para ${tipo}`);

  const body: SerasaScoreRequest = { document, model, entities: {} };

  const call = (token: string) =>
    http.post<SerasaScoreResponse>(`/ascend-ops/v1/${tipo}`, body, {
      headers: { Authorization: `Bearer ${token}` },
    });

  let token = await getAccessToken();
  let response;
  try {
    response = await call(token);
  } catch (err: any) {
    // Token pode ter expirado um pouco antes do cache local perceber — tenta 1x com token novo.
    if (err.response?.status === 401) {
      cachedToken = null;
      token = await login();
      response = await call(token);
    } else {
      throw err;
    }
  }

  const score = response.data?.payload?.model_scores?.[0]?.score;
  if (score === undefined || score === null) {
    throw new Error('Score não retornado pela Serasa');
  }
  return score;
};
