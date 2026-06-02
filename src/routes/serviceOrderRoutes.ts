import { Router } from 'express';
import * as serviceOrderController from '../controllers/serviceOrderController';

const router = Router();

router.get('/', serviceOrderController.getAllServiceOrders);
router.get('/:id', serviceOrderController.getServiceOrderById);
router.post('/', serviceOrderController.createServiceOrder);
router.put('/:id', serviceOrderController.updateServiceOrder);
router.patch('/:id/status', serviceOrderController.updateServiceOrderStatus);
router.delete('/:id', serviceOrderController.deleteServiceOrder);

export default router;
