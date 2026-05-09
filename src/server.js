const express = require('express');
const cors = require('cors');
require('dotenv').config();

const healthRoutes = require('./routes/health');
const clientRoutes = require('./routes/clients');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const invoiceRoutes = require('./routes/invoices');
const proposalRoutes = require('./routes/proposals');
const publicRoutes = require('./routes/public');
const statsRoutes = require('./routes/stats');
const webhookRoutes = require('./routes/webhooks');
const settingsRoutes = require('./routes/settings');
const orgRoutes = require('./routes/orgs');
const billingRoutes = require('./routes/billing'); // NEW

const { billingGuard } = require('./middleware/billingGuard'); // NEW

const corsOptions = {
  origin: [
    'http://localhost:5173', 
    'http://localhost:5174',
    'https://regulus-frontend.vercel.app' 
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-org-id'] // Added x-org-id for Gatekeeper
};

const app = express();
app.use(cors(corsOptions));

// 1. STRIPE WEBHOOK (MUST BE RAW BODY, BEFORE EXPRESS.JSON)
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// 2. PARSE JSON FOR EVERYTHING ELSE
app.use(express.json());

// Traffic Logger
app.use((req, res, next) => {
  console.log(`[TRAFFIC] ${req.method} ${req.url}`);
  next();
});

// 3. PUBLIC & AUTH ROUTES
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/webhooks', webhookRoutes); 

// 4. INFRASTRUCTURE ROUTES (Unlocked so they can manage settings/billing)
app.use('/api/orgs', orgRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/billing', billingRoutes);

// 5. THE GATEKEEPER: PROTECTED SAAS ROUTES (Locked if trial expires)
app.use('/api/stats', billingGuard, statsRoutes);
app.use('/api/clients', billingGuard, clientRoutes);
app.use('/api/projects', billingGuard, projectRoutes);
app.use('/api/invoices', billingGuard, invoiceRoutes);
app.use('/api/proposals', billingGuard, proposalRoutes);

// Global 404 Handler - MUST BE LAST
app.use((req, res) => {
  console.log(`[404] Resource not found: ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[SYSTEM] Regulus API Gateway operational on port ${PORT}`);
});