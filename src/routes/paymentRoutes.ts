import { Router } from 'express';
import { createChargeForInvoice, setupSubaccount, verifySubaccount } from '../controllers/paymentController';
import { authorize } from '../middleware/auth';

const router = Router();

// 'Admin' e 'Administrador' aceitos por divergência de string entre módulos — ver PROJECT_REFERENCE.md §4.4/11.3
const fullAccess = authorize(['Admin', 'Administrador', 'Diretoria', 'Gerente']);

router.post('/setup/subaccount', fullAccess, setupSubaccount);
router.get('/setup/subaccount/verify', fullAccess, verifySubaccount);
router.post('/invoices/:id/charge', createChargeForInvoice);

export default router;
