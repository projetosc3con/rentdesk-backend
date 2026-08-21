import { Router } from 'express';
import { emitNfse, getNfseStatus } from '../controllers/fiscalController';
import { authorize } from '../middleware/auth';

const router = Router();

// Acesso irrestrito: Administrador/Diretoria/Gerente. Financeiro: ler e
// alterar sem excluir. Critério confirmado com o Victor em 19/08/2026.
const fullAccess = authorize(['Administrador', 'Diretoria', 'Gerente', 'Financeiro']);

router.post('/invoices/:id/nfse', fullAccess, emitNfse);
router.get('/invoices/:id/nfse', fullAccess, getNfseStatus);

export default router;
