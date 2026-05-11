const express = require('express');
const cors = require('cors');
require('dotenv').config();

// 1. ROUTE IMPORTS 
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
const updatesRoutes = require('./routes/updates'); // FIX 1: Import updates
const portalRoutes = require('./routes/portal');   // FIX 2: Import portal

// Premium Feature Imports
const vaultRoutes = require('./routes/vault');
const contractRoutes = require('./routes/contracts');
const infrastructureRoutes = require('./routes/infrastructure');

// Middleware
const { requireAuth } = require('./middleware/auth'); // Import requireAuth
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
app.use('/api/portal', portalRoutes); // FIX 2: Mount portal
app.use('/api/webhooks', webhookRoutes); 

// Infrastructure Routes
app.use('/api/orgs', orgRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/billing', billingRoutes);

// ==========================================
// 4. THE GATEKEEPER: PROTECTED SAAS ROUTES
// ==========================================
// FIX 3: Apply requireAuth BEFORE billingGuard
app.use('/api/stats', requireAuth, billingGuard, statsRoutes);
app.use('/api/clients', requireAuth, billingGuard, clientRoutes);
app.use('/api/projects', requireAuth, billingGuard, projectRoutes);
app.use('/api/invoices', requireAuth, billingGuard, invoiceRoutes);
app.use('/api/proposals', requireAuth, billingGuard, proposalRoutes);
app.use('/api/updates', requireAuth, billingGuard, updatesRoutes); // FIX 1: Mount updates

// Regulus Enterprise Features (LOCKED DOWN)
app.use('/api/vault', requireAuth, billingGuard, vaultRoutes);
app.use('/api/contracts', requireAuth, billingGuard, contractRoutes);
app.use('/api/infrastructure', requireAuth, billingGuard, infrastructureRoutes);

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