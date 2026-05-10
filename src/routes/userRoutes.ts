import { Router } from 'express';
import * as userController from '../controllers/userController';

const router = Router();

// Rotas autenticadas (protegidas pelo middleware de auth no app.ts)
router.get('/', userController.getAllUserProfiles);
router.get('/me', userController.getCurrentUserProfile);
router.post('/pre-register', userController.preRegisterUser);
router.put('/:id', userController.updateUserProfile);

export default router;
