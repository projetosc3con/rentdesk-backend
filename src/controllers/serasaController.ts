import { Request, Response } from 'express';
import { consultarScore as fetchScore } from '../services/serasaService';
import { DocumentType } from '../types/serasa';

export const consultarScore = async (req: Request, res: Response) => {
  try {
    const { documento } = req.body;
    if (!documento) {
      return res.status(400).json({ sucesso: false, mensagem: 'Documento é obrigatório.' });
    }

    const clean = String(documento).replace(/\D/g, '');
    let tipo: DocumentType;
    let documentToSend: string;

    if (clean.length === 11) {
      tipo = 'PF';
      documentToSend = clean;
    } else if (clean.length === 14) {
      tipo = 'PJ';
      documentToSend = clean.substring(0, 8); // raiz do CNPJ
    } else {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Documento inválido. Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).',
      });
    }

    const score = await fetchScore(documentToSend, tipo);
    return res.status(200).json({ sucesso: true, score, tipo });
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 400) {
      return res.status(400).json({ sucesso: false, mensagem: 'Dados inválidos enviados à Serasa.' });
    }
    if (status === 401 || status === 403) {
      return res.status(401).json({ sucesso: false, mensagem: 'Falha na autenticação com o serviço de score.' });
    }
    if (status === 422) {
      return res.status(422).json({ sucesso: false, mensagem: 'Não foi possível processar a consulta para este documento.' });
    }
    if (status === 429) {
      return res.status(429).json({ sucesso: false, mensagem: 'Limite de consultas excedido. Tente novamente em instantes.' });
    }
    console.error('[serasaController] Erro ao consultar score:', error.response?.data || error.message);
    return res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao consultar o score. Tente novamente mais tarde.' });
  }
};
