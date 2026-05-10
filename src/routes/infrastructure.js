const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

router.use(requireAuth);

// ==========================================
// TRIGGER IaC PROVISIONING
// ==========================================
router.post('/provision', async (req, res) => {
  // ROBUST CONTEXT: Check headers OR the request body
  const orgId = req.headers['x-org-id'] || req.body.org_id;
  
  if (!orgId) {
    return res.status(400).json({ error: 'Organization context missing. Please refresh.' });
  }

  try {
    const { project_id, stack_template, repo_name, env_variables } = req.body;

    // 1. Verify the project exists AND belongs to this exact organization
    const { data: project, error: projectErr } = await supabaseAdmin
      .from('projects')
      .select('*, clients(name, email)')
      .eq('id', project_id)
      .eq('org_id', orgId) // <-- If this is NULL in Supabase, this query fails
      .single();

    if (projectErr || !project) {
      console.error(`[IaC Auth Block]: Project ${project_id} not found for Org ${orgId}`);
      return res.status(404).json({ error: 'Project not found or access denied. Ensure it is linked to your workspace.' });
    }

    // 2. Build the Provisioning Payload
    const iacPayload = {
      event: 'infrastructure.provision',
      org_id: orgId,
      client: {
        id: project.client_id,
        name: project.clients?.name,
      },
      project: {
        id: project.id,
        name: project.name,
      },
      deployment: {
        template: stack_template, 
        repo_name: repo_name.toLowerCase().replace(/\s+/g, '-'),
        environment: 'production',
        injected_secrets: env_variables || []
      },
      timestamp: new Date().toISOString()
    };

    // 3. Fire the payload to your automation layer
    const WEBHOOK_URL = process.env.N8N_PROVISIONING_WEBHOOK;
    
    if (WEBHOOK_URL) {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(iacPayload)
      });
    } else {
      console.warn('⚠️ N8N_PROVISIONING_WEBHOOK is not set. Simulating successful dispatch.');
    }

    // 4. Update project status
    await supabaseAdmin
      .from('projects')
      .update({ status: 'Provisioning Infrastructure' })
      .eq('id', project_id);

    res.status(200).json({ 
      message: 'Infrastructure provisioning dispatched successfully.',
      pipeline_id: `pipe_${Date.now()}`
    });

  } catch (err) {
    console.error('[IaC Provisioning Error]:', err.message);
    res.status(500).json({ error: 'Failed to dispatch infrastructure pipeline.' });
  }
});

module.exports = router;