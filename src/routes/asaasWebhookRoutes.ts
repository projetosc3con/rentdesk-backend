import { Router } from 'express';
import { handleAsaasWebhook } from '../controllers/asaasWebhookController';
import { handleAsaasTransferApproval } from '../controllers/asaasTransferApprovalController';

const router = Router();

// Sem middleware `authenticate` de propósito — o Asaas chama server-to-server,
// sem sessão de usuário; a autenticação é o header asaas-access-token checado
// dentro do controller.
router.post('/asaas', handleAsaasWebhook);

// Mecanismo de validação de saque (Integrações > Mecanismos de Segurança no
// painel Asaas) — endpoint distinto, com token próprio (ASAAS_TRANSFER_APPROVAL_TOKEN),
// configurado separadamente de Webhooks > Configurações.
router.post('/asaas-transfer-approval', handleAsaasTransferApproval);

export default router;
