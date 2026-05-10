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
  getAllContacts,
  createContact,
  updateContact,
  deleteContact,
  convertLead,
  deleteLead,
  getDeals,
  createDeal,
  updateDeal,
  deleteDeal,
  getDealActivities,
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  checkCnpj
} from '../controllers/crmController';

const router = Router();

// Pipelines
router.get('/pipelines', getPipelines);
router.post('/pipelines', createPipeline);
router.put('/pipelines/:id', updatePipeline);
router.delete('/pipelines/:id', deletePipeline);

// Contacts
router.get('/contacts', getAllContacts);
router.post('/contacts', createContact);
router.put('/contacts/:id', updateContact);
router.delete('/contacts/:id', deleteContact);

// Leads
router.get('/leads', getLeads);
router.post('/leads', createLead);
router.put('/leads/:id', updateLead);
router.get('/leads/:id/contacts', getLeadContacts);
router.post('/leads/:id/convert', convertLead);
router.delete('/leads/:id', deleteLead);
router.get('/leads/check-cnpj/:cnpj', checkCnpj);


// Task Types
router.get('/task-types', getTaskTypes);

// Deals
router.get('/deals', getDeals);
router.post('/deals', createDeal);
router.put('/deals/:id', updateDeal);
router.delete('/deals/:id', deleteDeal);
router.get('/deals/activities', getDealActivities);

// Tasks
router.get('/tasks', getTasks);
router.get('/tasks/types', getTaskTypes);
router.post('/tasks', createTask);
router.patch('/tasks/:id', updateTask);
router.delete('/tasks/:id', deleteTask);

export default router;
