import { Router } from 'express';
import { consultarScore, getAsaasScoreInfo } from '../controllers/serasaController';

const router = Router();

router.get('/info', getAsaasScoreInfo);
router.post('/', consultarScore);

export default router;
