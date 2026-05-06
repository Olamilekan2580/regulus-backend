const express = require('express');
const cors = require('cors');
require('dotenv').config();

const clientRoutes = require('./routes/clients');
const authRoutes = require('./routes/auth')
const projectRoutes = require('./routes/projects');
const invoiceRoutes = require('./routes/invoices');
const proposalRoutes = require('./routes/proposals');
const publicRoutes = require('./routes/public');
const statsRoutes = require('./routes/stats');
const webhookRoutes = require('./routes/webhooks');
const settingsRoutes = require('./routes/settings');

const app = express();

app.use(cors());
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
app.use('/api/proposals', proposalRoutes);
app.use('/api/public', publicRoutes); // Public route must be before the 404 handler
app.use('/api/settings', settingsRoutes);

// Global 404 Handler - MUST BE LAST
app.use((req, res) => {
  console.log(`[404] Resource not found: ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[SYSTEM] Regulus API Gateway operational on port ${PORT}`);
});
