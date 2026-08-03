import { Router } from 'express';
import { emitNfse, getNfseStatus } from '../controllers/fiscalController';
import { authorize } from '../middleware/auth';

const router = Router();

// 'Admin' e 'Administrador' aceitos por divergência de string entre módulos — ver PROJECT_REFERENCE.md
const fullAccess = authorize(['Admin', 'Administrador', 'Diretoria', 'Gerente']);

router.post('/invoices/:id/nfse', fullAccess, emitNfse);
router.get('/invoices/:id/nfse', getNfseStatus);

export default router;
