const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// 1. ROUTE IMPORTS
const usersRoutes = require('./routes/users'); 
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
const updatesRoutes = require('./routes/updates'); 
const portalRoutes = require('./routes/portal');
const payoutRoutes = require('./routes/payouts');   

// Premium Feature Imports
const vaultRoutes = require('./routes/vault');
const contractRoutes = require('./routes/contracts');
const infrastructureRoutes = require('./routes/infrastructure');

// Middleware
const { requireAuth } = require('./middleware/auth'); 
const { billingGuard } = require('./middleware/billingGuard');

const corsOptions = {
  origin: [
    'http://localhost:5173', 
    'http://localhost:5174',
    'https://regulus-frontend.vercel.app',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-org-id']
};

const app = express();

// ==========================================
// 1.5 SECURITY MIDDLEWARES
// ==========================================
app.use(helmet()); // Secures HTTP headers

// Global Rate Limiter to prevent brute-force/DDoS
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});
app.use(globalLimiter);

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
// INFRASTRUCTURE KEEP-ALIVE (DO NOT DELETE)
// ==========================================
app.get('/api/ping', (req, res) => {
  res.status(200).send('awake');
});

// ==========================================
// 3. UNGATED ROUTES (Public, Auth, Core Settings)
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api/users', requireAuth, usersRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/portal', portalRoutes); 
app.use('/api/webhooks', webhookRoutes); 

// Infrastructure Routes
app.use('/api/orgs', orgRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/billing', billingRoutes);

// ==========================================
// 4. THE GATEKEEPER: PROTECTED SAAS ROUTES
// ==========================================
app.use('/api/stats', requireAuth, billingGuard, statsRoutes);
app.use('/api/clients', requireAuth, billingGuard, clientRoutes);
app.use('/api/projects', requireAuth, billingGuard, projectRoutes);
app.use('/api/invoices', requireAuth, billingGuard, invoiceRoutes);
app.use('/api/proposals', requireAuth, billingGuard, proposalRoutes);
app.use('/api/updates', requireAuth, billingGuard, updatesRoutes);
app.use('/api/payouts', requireAuth, billingGuard, payoutRoutes); 

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