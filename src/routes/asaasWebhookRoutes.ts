import { Router } from 'express';
import { handleAsaasWebhook } from '../controllers/asaasWebhookController';

const router = Router();

// Sem middleware `authenticate` de propósito — o Asaas chama server-to-server,
// sem sessão de usuário; a autenticação é o header asaas-access-token checado
// dentro do controller.
router.post('/asaas', handleAsaasWebhook);

export default router;
