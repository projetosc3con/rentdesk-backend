import { Router } from 'express';
import {
  createChargeForInvoice,
  getInvoicePayments,
  listPayments,
} from '../controllers/paymentController';
import { authorize } from '../middleware/auth';

const router = Router();

// Acesso irrestrito: Administrador/Diretoria/Gerente. Financeiro: ler e
// alterar sem excluir. Critério confirmado com o Victor em 19/08/2026.
const fullAccess = authorize(['Administrador', 'Diretoria', 'Gerente', 'Financeiro']);
// Emitir boleto (criar cobrança) também precisa estar liberado pra Logística
// — pedido explícito do Victor, endpoint que antes não tinha checagem de role nenhuma.
const chargeAccess = authorize(['Administrador', 'Diretoria', 'Gerente', 'Financeiro', 'Logística']);

router.post('/invoices/:id/charge', chargeAccess, createChargeForInvoice);
router.get('/invoices/:id', fullAccess, getInvoicePayments);
// Extrato geral — dado financeiro cross-cliente, mesmo nível de acesso das demais rotas sensíveis.
router.get('/', fullAccess, listPayments);

export default router;
