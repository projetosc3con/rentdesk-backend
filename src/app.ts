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

// Protected routes
app.use('/api/rentals', authenticate, rentalRoutes);
app.use('/api/equipments', authenticate, equipmentRoutes);
app.use('/api/clients', authenticate, clientRoutes);
app.use('/api/parts', authenticate, partRoutes);
app.use('/api/service-orders', authenticate, serviceOrderRoutes);
app.use('/api/users', authenticate, userRoutes);

app.listen(PORT, () => {
  console.log(`RentDesk Backend running on http://localhost:${PORT}`);
});

export default app;
