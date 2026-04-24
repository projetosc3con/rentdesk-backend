import { Router } from 'express';
import { exportClientsToXlsx } from '../controllers/exportController';

const router = Router();

// GET /api/exports/clients → generates XLSX, uploads to storage, returns signed download URL
router.get('/clients', exportClientsToXlsx);

export default router;
