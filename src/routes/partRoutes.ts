import { Router } from 'express';
import * as partController from '../controllers/partController';

const router = Router();

router.get('/', partController.getAllParts);
router.get('/:id', partController.getPartById);
router.post('/', partController.createPart);
router.put('/:id', partController.updatePart);
router.delete('/:id', partController.deletePart);

export default router;
