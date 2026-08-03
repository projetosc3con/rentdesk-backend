import { Router } from 'express';
import { listBills, createBill } from '../controllers/billController';
import { authorize } from '../middleware/auth';

const router = Router();

// 'Admin' e 'Administrador' aceitos por divergência de string entre módulos — ver PROJECT_REFERENCE.md §4.4/11.3
const fullAccess = authorize(['Admin', 'Administrador', 'Diretoria', 'Gerente']);

// Conciliação bancária — dado financeiro cross-cliente, mesmo nível de acesso
// das demais rotas sensíveis (ver TODO(SECURITY) em billController.ts sobre
// RLS ainda não estar configurada em `bills`).
router.get('/', fullAccess, listBills);
router.post('/', fullAccess, createBill);

export default router;
