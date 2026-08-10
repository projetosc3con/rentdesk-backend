import { Router } from 'express';
import {
  createChargeForInvoice,
  getInvoicePayments,
  listPayments,
} from '../controllers/paymentController';
import { authorize } from '../middleware/auth';

const router = Router();

// 'Admin' e 'Administrador' aceitos por divergência de string entre módulos — ver PROJECT_REFERENCE.md §4.4/11.3
const fullAccess = authorize(['Admin', 'Administrador', 'Diretoria', 'Gerente']);

router.post('/invoices/:id/charge', createChargeForInvoice);
router.get('/invoices/:id', getInvoicePayments);
// Extrato geral — dado financeiro cross-cliente, mesmo nível de acesso das demais rotas sensíveis.
router.get('/', fullAccess, listPayments);

export default router;
