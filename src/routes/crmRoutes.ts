import { Router } from 'express';
import {
  getPipelines,
  getTaskTypes,
  createPipeline,
  updatePipeline,
  deletePipeline,
  getLeads,
  createLead,
  updateLead,
  getLeadContacts,
  convertLead
} from '../controllers/crmController';

const router = Router();

// Pipelines
router.get('/pipelines', getPipelines);
router.post('/pipelines', createPipeline);
router.put('/pipelines/:id', updatePipeline);
router.delete('/pipelines/:id', deletePipeline);

// Leads
router.get('/leads', getLeads);
router.post('/leads', createLead);
router.put('/leads/:id', updateLead);
router.get('/leads/:id/contacts', getLeadContacts);
router.post('/leads/:id/convert', convertLead);


// Task Types
router.get('/task-types', getTaskTypes);

export default router;
