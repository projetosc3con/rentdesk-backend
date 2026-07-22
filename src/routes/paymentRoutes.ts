import { Router } from 'express';
import { createChargeForInvoice } from '../controllers/paymentController';

const router = Router();

router.post('/invoices/:id/charge', createChargeForInvoice);

export default router;
