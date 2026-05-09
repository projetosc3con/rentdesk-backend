import { Router } from 'express';
import * as clientController from '../controllers/clientController';
import { authorize } from '../middleware/auth';

const router = Router();

// Full access routes (Admin, Diretoria, Gerente)
const fullAccess = authorize(['Admin', 'Diretoria', 'Gerente']);

router.get('/', clientController.getAllClients);
router.get('/:id', clientController.getClientById);
router.post('/', fullAccess, clientController.createClient);
router.put('/:id', clientController.updateClient); // Assuming Comercial can edit clients as they can access /clientes/:id
router.delete('/:id', fullAccess, clientController.deleteClient);

export default router;
