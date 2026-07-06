import { Router } from 'express';
import { getPositions, getLevels, getEmployees, getRecentActivities, getPositionHistory, getDocumentTypes, createDocumentType, updateDocumentType, createPosition, getPositionById, updatePosition } from '../controllers/hrController';

const router = Router();

router.get('/positions', getPositions);
router.post('/positions', createPosition);
router.get('/positions/:id', getPositionById);
router.put('/positions/:id', updatePosition);
router.get('/levels', getLevels);
router.get('/employees', getEmployees);
router.get('/recent-activities', getRecentActivities);
router.get('/position-history', getPositionHistory);
router.get('/document-types', getDocumentTypes);
router.post('/document-types', createDocumentType);
router.put('/document-types/:id', updateDocumentType);

export default router;
