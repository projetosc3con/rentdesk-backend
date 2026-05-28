import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { authenticate } from './middleware/auth';

import rentalRoutes from './routes/rentalRoutes';
import equipmentRoutes from './routes/equipmentRoutes';
import clientRoutes from './routes/clientRoutes';
import partRoutes from './routes/partRoutes';
import serviceOrderRoutes from './routes/serviceOrderRoutes';
import userRoutes from './routes/userRoutes';
import exportRoutes from './routes/exportRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import crmRoutes from './routes/crmRoutes';
import logisticsRoutes from './routes/logisticsRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes (no auth required - primeiro acesso)
import { checkEmailForSignup, completeSignup } from './controllers/userController';
app.post('/api/auth/check-email', checkEmailForSignup);
app.post('/api/auth/complete-signup', completeSignup);

// Protected routes
app.use('/api/rentals', authenticate, rentalRoutes);
app.use('/api/equipments', authenticate, equipmentRoutes);
app.use('/api/clients', authenticate, clientRoutes);
app.use('/api/parts', authenticate, partRoutes);
app.use('/api/service-orders', authenticate, serviceOrderRoutes);
app.use('/api/users', authenticate, userRoutes);
app.use('/api/exports', authenticate, exportRoutes);
app.use('/api/dashboard', authenticate, dashboardRoutes);
app.use('/api/crm', authenticate, crmRoutes);
app.use('/api/logistics', authenticate, logisticsRoutes);

app.listen(PORT, () => {
  console.log(`RentDesk Backend running on http://localhost:${PORT}`);
});

export default app;
