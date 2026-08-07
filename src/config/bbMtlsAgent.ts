import fs from 'fs';
import https from 'https';
import axios, { AxiosInstance } from 'axios';

// A API de Extratos do BB (e provavelmente as demais) exige mTLS — certificado
// cliente na conexão TLS — tanto em homologação quanto em produção (não é
// opcional, confirmado com quem já testou). Ainda não sabemos se o Portal
// Developers BB entrega o certificado como PEM separado (cert+key) ou como
// PFX/P12 — este módulo aceita os dois formatos, com preferência por PFX
// quando ambos estiverem configurados. Cada variante também aceita o
// conteúdo em base64 direto na env var, além do caminho de arquivo, pra
// cobrir ambientes sem disco persistente.
let cachedAgent: https.Agent | null = null;

function readFileOrBase64(pathEnv: string | undefined, base64Env: string | undefined): Buffer | null {
  if (base64Env) return Buffer.from(base64Env, 'base64');
  if (pathEnv) return fs.readFileSync(pathEnv);
  return null;
}

export function getBbHttpsAgent(): https.Agent {
  if (cachedAgent) return cachedAgent;

  const ca = readFileOrBase64(process.env.BB_MTLS_CA_PATH, process.env.BB_MTLS_CA_BASE64) ?? undefined;

  const pfx = readFileOrBase64(process.env.BB_MTLS_PFX_PATH, process.env.BB_MTLS_PFX_BASE64);
  if (pfx) {
    cachedAgent = new https.Agent({ pfx, passphrase: process.env.BB_MTLS_PFX_PASSPHRASE, ca });
    return cachedAgent;
  }

  const cert = readFileOrBase64(process.env.BB_MTLS_CERT_PATH, process.env.BB_MTLS_CERT_BASE64);
  const key = readFileOrBase64(process.env.BB_MTLS_KEY_PATH, process.env.BB_MTLS_KEY_BASE64);
  if (cert && key) {
    cachedAgent = new https.Agent({ cert, key, ca });
    return cachedAgent;
  }

  throw new Error(
    'Certificado mTLS do BB não configurado. Defina BB_MTLS_PFX_PATH/BB_MTLS_PFX_BASE64 (+ BB_MTLS_PFX_PASSPHRASE) ' +
    'ou BB_MTLS_CERT_PATH+BB_MTLS_KEY_PATH (ou as variantes _BASE64).'
  );
}

export function createBbHttpClient(baseURL: string): AxiosInstance {
  return axios.create({
    baseURL,
    httpsAgent: getBbHttpsAgent(),
    headers: { 'Content-Type': 'application/json' },
  });
}
