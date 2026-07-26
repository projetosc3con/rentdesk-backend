import { Router } from 'express';
import * as clientController from '../controllers/clientController';
import { authorize } from '../middleware/auth';

const router = Router();

// Full access routes (Admin, Diretoria, Gerente)
// 'Admin' e 'Administrador' aceitos por divergência de string entre módulos — ver PROJECT_REFERENCE.md §4.4/11.3
const fullAccess = authorize(['Admin', 'Administrador', 'Diretoria', 'Gerente']);

router.get('/', clientController.getAllClients);
router.get('/:id', clientController.getClientById);
router.post('/', fullAccess, clientController.createClient);
router.put('/:id', clientController.updateClient); // Assuming Comercial can edit clients as they can access /clientes/:id
router.post('/:id/asaas-sync', clientController.syncClientAsaas);
router.get('/:id/asaas-verify', clientController.verifyClientAsaas);
router.delete('/:id', fullAccess, clientController.deleteClient);

export default router;
