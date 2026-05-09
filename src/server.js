const express = require('express');
const cors = require('cors');
require('dotenv').config();

const healthRoutes = require('./routes/health');
const clientRoutes = require('./routes/clients');
const authRoutes = require('./routes/auth')
const projectRoutes = require('./routes/projects');
const invoiceRoutes = require('./routes/invoices');
const proposalRoutes = require('./routes/proposals');
const publicRoutes = require('./routes/public');
const statsRoutes = require('./routes/stats');
const webhookRoutes = require('./routes/webhooks');
const settingsRoutes = require('./routes/settings');
const orgRoutes = require('./routes/orgs');
const corsOptions = {
  origin: [
    'http://localhost:5173', 
    'http://localhost:5174', // Cover all common local ports
    'https://regulus-frontend.vercel.app' // Replace with your ACTUAL Vercel URL
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

const app = express();

app.use(cors(corsOptions));
app.use(express.json());

// Traffic Logger
app.use((req, res, next) => {
  console.log(`[TRAFFIC] ${req.method} ${req.url}`);
  next();
});

// ROUTE MOUNTING (Order is Critical)
app.use('/api/auth', authRoutes)
app.use('/api/stats', statsRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/orgs', orgRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/public', publicRoutes); // Public route must be before the 404 handler
app.use('/api/settings', settingsRoutes);
app.use('/api/health', healthRoutes);

// Global 404 Handler - MUST BE LAST
app.use((req, res) => {
  console.log(`[404] Resource not found: ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[SYSTEM] Regulus API Gateway operational on port ${PORT}`);
});
