import { Router } from 'express';
import * as userController from '../controllers/userController';

const router = Router();

router.get('/', userController.getAllUserProfiles);
router.get('/me', userController.getCurrentUserProfile);
router.post('/invite', userController.inviteUser);
router.put('/:id', userController.updateUserProfile);

export default router;
