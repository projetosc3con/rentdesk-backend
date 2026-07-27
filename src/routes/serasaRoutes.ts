import { Router } from 'express';
import { consultarScore } from '../controllers/serasaController';

const router = Router();

router.post('/', consultarScore);

export default router;
