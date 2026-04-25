import { Router } from 'express';
import * as dashboardController from '../controllers/dashboardController';

const router = Router();

router.get('/', dashboardController.getDashboardData);

export default router;
