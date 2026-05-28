import { Router } from 'express';
import {
  getAllContracts,
  getContractById,
  startTriage,
  finishProcessing,
  saveTriagePhoto,
  getTriagePhotos,
  deleteTriagePhoto
} from '../controllers/logisticsController';

const router = Router();

// List all contracts for the logistics board
router.get('/contracts', getAllContracts);

// Get a single contract with full details for triage
router.get('/contracts/:id', getContractById);

// Start triage on a contract (Assinado → Triagem)
router.patch('/contracts/:id/start-triage', startTriage);

// Finish processing a contract (Triagem → Processado)
router.patch('/contracts/:id/finish', finishProcessing);

// Triage photo checklist
router.post('/contracts/:id/triage-photos', saveTriagePhoto);
router.get('/contracts/:id/triage-photos', getTriagePhotos);
router.delete('/contracts/:id/triage-photos/:photoId', deleteTriagePhoto);

export default router;
