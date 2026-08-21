import { Router } from 'express';
import { listBills, createBill } from '../controllers/billController';
import { reconcileBankStatement, linkStatementLineToBill } from '../controllers/bankReconciliationController';
import { authorize } from '../middleware/auth';

const router = Router();

// Acesso irrestrito: Administrador/Diretoria/Gerente. Financeiro: ler e
// alterar sem excluir (não há endpoint de exclusão em bills, então entra
// no mesmo nível) — critério confirmado com o Victor em 19/08/2026.
const fullAccess = authorize(['Administrador', 'Diretoria', 'Gerente', 'Financeiro']);

// Conciliação bancária — dado financeiro cross-cliente, mesmo nível de acesso
// das demais rotas sensíveis (ver TODO(SECURITY) em billController.ts sobre
// RLS ainda não estar configurada em `bills`).
router.get('/', fullAccess, listBills);
router.post('/', fullAccess, createBill);
router.post('/reconcile', fullAccess, reconcileBankStatement);
router.post('/:id/link-statement-line', fullAccess, linkStatementLineToBill);

export default router;
