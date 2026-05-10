const express = require('express');
const cors = require('cors');
require('dotenv').config();

// 1. ROUTE IMPORTS (Cleanly structured)
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
const billingRoutes = require('./routes/billing');

// Premium Feature Imports
const vaultRoutes = require('./routes/vault');
const contractRoutes = require('./routes/contracts');
const infrastructureRoutes = require('./routes/infrastructure');

// Middleware
const { billingGuard } = require('./middleware/billingGuard');

const corsOptions = {
  origin: [
    'http://localhost:5173', 
    'http://localhost:5174',
    'https://regulus-frontend.vercel.app' 
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-org-id']
};

const app = express();
app.use(cors(corsOptions));

// ==========================================
// 2. PARSER PIPELINE (CRITICAL STRIPE FIX)
// ==========================================
// Because express.raw is placed here, req.body becomes a Buffer for the webhook, 
// causing express.json() to safely skip it on the next line.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Traffic Logger
app.use((req, res, next) => {
  console.log(`[TRAFFIC] ${req.method} ${req.url}`);
  next();
});

// ==========================================
// 3. UNGATED ROUTES (Public, Auth, Core Settings)
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/webhooks', webhookRoutes); 

// Infrastructure Routes (Unlocked so they can manage settings/billing)
app.use('/api/orgs', orgRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/billing', billingRoutes);

// ==========================================
// 4. THE GATEKEEPER: PROTECTED SAAS ROUTES
// ==========================================
// Core Operations
app.use('/api/stats', billingGuard, statsRoutes);
app.use('/api/clients', billingGuard, clientRoutes);
app.use('/api/projects', billingGuard, projectRoutes);
app.use('/api/invoices', billingGuard, invoiceRoutes);
app.use('/api/proposals', billingGuard, proposalRoutes);

// Regulus Enterprise Features (LOCKED DOWN)
app.use('/api/vault', billingGuard, vaultRoutes);
app.use('/api/contracts', billingGuard, contractRoutes);
app.use('/api/infrastructure', billingGuard, infrastructureRoutes);

// ==========================================
// 5. GLOBAL 404 HANDLER
// ==========================================
app.use((req, res) => {
  console.log(`[404] Resource not found: ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[SYSTEM] Regulus API Gateway operational on port ${PORT}`);
});