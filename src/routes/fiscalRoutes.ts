import { Router } from 'express';
import { emitNfse, getNfseStatus } from '../controllers/fiscalController';
import * as nfeImportController from '../controllers/nfeImportController';
import { authorize } from '../middleware/auth';

const router = Router();

// Acesso NFS-e: Administrador/Diretoria/Gerente/Financeiro
const fullAccess = authorize(['Administrador', 'Diretoria', 'Gerente', 'Financeiro']);
// Acesso Importação NF-e XML: Administrador/Diretoria/Gerente/Financeiro/Manutenção/Logística
const nfeAccess = authorize(['Administrador', 'Diretoria', 'Gerente', 'Financeiro', 'Manutenção', 'Logística']);

// Emissão e consulta de NFS-e de locação
router.post('/invoices/:id/nfse', fullAccess, emitNfse);
router.get('/invoices/:id/nfse', fullAccess, getNfseStatus);

// Importação e processamento de NF-e XML (Entrada/Saída de Peças, Ativos, Consumo, EPI)
router.post('/nfe/parse', nfeAccess, nfeImportController.parseXml);
router.post('/nfe/process', nfeAccess, nfeImportController.processImport);
router.get('/nfe/history', nfeAccess, nfeImportController.listImports);
router.get('/nfe/:id', nfeAccess, nfeImportController.getImportById);

export default router;

