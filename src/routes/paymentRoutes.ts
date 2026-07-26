import { Router } from 'express';
import { createChargeForInvoice, setupSubaccount, verifySubaccount } from '../controllers/paymentController';

const router = Router();

// 'Admin' e 'Administrador' aceitos por divergência de string entre módulos — ver PROJECT_REFERENCE.md §4.4/11.3
// TODO: reativar após testes Asaas — fullAccess = authorize(['Admin', 'Administrador', 'Diretoria', 'Gerente']);
router.post('/setup/subaccount', setupSubaccount);
router.get('/setup/subaccount/verify', verifySubaccount);
router.post('/invoices/:id/charge', createChargeForInvoice);

export default router;
