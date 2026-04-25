import { Router } from 'express';
import { exportClientsToXlsx, exportRentalsToXlsx } from '../controllers/exportController';

const router = Router();

// GET /api/exports/clients → generates XLSX, uploads to storage, returns signed download URL
router.get('/clients', exportClientsToXlsx);

// GET /api/exports/rentals → generates XLSX for rental invoices with optional filters
router.get('/rentals', exportRentalsToXlsx);

export default router;

