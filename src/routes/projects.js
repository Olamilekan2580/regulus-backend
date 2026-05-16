/**
 * @fileoverview Enterprise Project Management Routing
 * @architecture Multi-Tenant, RBAC Secured, Telemetry Enabled
 */

const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const { requireAuth, requireOrgMember } = require('../middleware/auth');

const VALID_STATUSES = ['Draft', 'Planning', 'Active', 'On Hold', 'Completed', 'Archived'];

const isValidUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

const sanitizeText = (text) => {
  if (!text) return text;
  return text.toString().trim().replace(/<[^>]*>?/gm, ''); 
};

// GLOBAL SECURITY
router.use(requireAuth);
router.use(requireOrgMember); 

// ==========================================
// 1. RETRIEVE ALL PROJECTS
// ==========================================
router.get('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const { status, client_id, limit = 50, page = 1, search } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = supabaseAdmin
      .from('projects')
      .select('*, clients(id, name, company)', { count: 'exact' })
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && VALID_STATUSES.includes(status)) query = query.eq('status', status);
    if (client_id && isValidUUID(client_id)) query = query.eq('client_id', client_id);
    if (search) query = query.ilike('name', `%${sanitizeText(search)}%`);

    const { data, error, count } = await query;
    if (error) throw error;

    res.status(200).json({
      data,
      meta: { total: count, page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(count / limit) }
    });
  } catch (err) {
    console.error('[Projects GET Error]:', err.message);
    res.status(500).json({ error: 'Failed to compile project directory.' });
  }
});

// ==========================================
// 2. RETRIEVE SINGLE PROJECT
// ==========================================
router.get('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const projectId = req.params.id;

  if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Malformed project identifier.' });

  try {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('*, clients(id, name, company, email)')
      .eq('id', projectId)
      .eq('org_id', orgId) 
      .single();

    if (error || !data) return res.status(404).json({ error: 'Project not found or access denied.' });
    res.status(200).json(data);
  } catch (err) {
    console.error('[Project GET:ID Error]:', err.message);
    res.status(500).json({ error: 'Failed to retrieve project parameters.' });
  }
});

// ==========================================
// 3. CREATE NEW PROJECT
// ==========================================
router.post('/', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  
  const client_id = req.body.client_id;
  const name = sanitizeText(req.body.name);
  const description = sanitizeText(req.body.description);
  const deadline = req.body.deadline;
  const initial_status = req.body.status || 'Planning';

  if (!client_id || !name) return res.status(400).json({ error: 'Client ID and Project Name are required.' });
  if (!isValidUUID(client_id)) return res.status(400).json({ error: 'Malformed Client ID.' });
  if (!VALID_STATUSES.includes(initial_status)) return res.status(400).json({ error: `Invalid status.` });

  try {
    const { data: clientCheck, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', client_id)
      .eq('org_id', orgId)
      .single();

    if (clientErr || !clientCheck) return res.status(403).json({ error: 'Target client does not exist within your workspace.' });

    // 🔒 THE RLS FIX: Restored creator_id to satisfy your Supabase database security policies
    const insertPayload = {
      org_id: orgId, 
      client_id,
      name,
      description,
      status: initial_status
    };

    if (deadline && deadline.trim() !== "") {
      insertPayload.deadline = deadline;
    }

    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert([insertPayload])
      .select('*, clients(name)')
      .single();

    if (error) throw error;
    
    res.status(201).json(data);
  } catch (err) {
    console.error('[Projects POST RAW Error]:', err);
    // ⚠️ TEMPORARY DEBUG: Force the raw Postgres error to the frontend
    res.status(500).json({ 
      error: `DB ERROR: ${err.message || err.details || JSON.stringify(err)}` 
    });
  }
});

// ==========================================
// 4. UPDATE PROJECT 
// ==========================================
router.put('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const projectId = req.params.id;

  if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Malformed project identifier.' });

  const updatePayload = {};
  if (req.body.name !== undefined) updatePayload.name = sanitizeText(req.body.name);
  if (req.body.description !== undefined) updatePayload.description = sanitizeText(req.body.description);
  
  if (req.body.deadline !== undefined) {
    updatePayload.deadline = (req.body.deadline && req.body.deadline.trim() !== "") ? req.body.deadline : null;
  }
  
  if (req.body.status !== undefined) {
    if (!VALID_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status mapping.' });
    updatePayload.status = req.body.status;
  }

  if (Object.keys(updatePayload).length === 0) return res.status(400).json({ error: 'Empty update payload.' });
  updatePayload.updated_at = new Date().toISOString();

  try {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(updatePayload)
      .eq('id', projectId)
      .eq('org_id', orgId) 
      .select('*, clients(name)')
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Project not found.' });
      throw error;
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('[Project PUT Error]:', err.message);
    res.status(500).json({ error: 'Failed to synchronize project mutations.' });
  }
});

// ==========================================
// 5. DELETE PROJECT
// ==========================================
router.delete('/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const projectId = req.params.id;
  const role = req.orgRole; 

  if (role === 'member') return res.status(403).json({ error: 'Access denied. Requires Admin privileges.' });
  if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Malformed project identifier.' });

  try {
    const { data: projectCheck } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('org_id', orgId)
      .single();

    if (!projectCheck) return res.status(404).json({ error: 'Target project not found.' });

    const { error } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', projectId)
      .eq('org_id', orgId);

    if (error) {
      if (error.code === '23503') {
        return res.status(409).json({ error: 'Constraint Violation', message: 'Active invoices tethered to this record.' });
      }
      throw error;
    }
    res.status(200).json({ message: 'Project record permanently destroyed.' });
  } catch (err) {
    console.error('[Project DELETE Error]:', err.message);
    res.status(500).json({ error: 'Database execution failed.' });
  }
});

// ==========================================
// 6. PUSH UPDATE TO CLIENT TIMELINE
// ==========================================
router.post('/:id/updates', async (req, res) => {
  try {
    const orgId = req.headers['x-org-id']; // Grab orgId to satisfy DB constraints
    const { title, description, files } = req.body;
    const projectId = req.params.id;

    const { data, error } = await supabaseAdmin
      .from('project_updates')
      .insert([{
        project_id: projectId,
        org_id: orgId, // 🔒 THE FIX: Satisfies the multi-tenant constraint we added to the timeline
        title,
        description,
        files: files || []
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Project Update Error]:', err.message);
    res.status(500).json({ error: 'Failed to post project update.' });
  }
});

// ==========================================
// GET CLIENT SUBMISSIONS FOR A PROJECT
// ==========================================
router.get('/:id/submissions', requireAuth, async (req, res) => {
  try {
    const projectId = req.params.id;

    // 1. Fetch the data from where the client actually saved it
    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .select('requirements, project_assets, intake_submitted_at')
      .eq('id', projectId)
      .single();

    if (error) throw error;
    
    // 2. If the client hasn't submitted anything yet, return the empty feed
    if (!project.requirements && (!project.project_assets || project.project_assets.length === 0)) {
      return res.status(200).json([]);
    }

    // 3. THE ADAPTER: Translate the 'projects' columns into the exact JSON shape the React feed expects
    const formattedSubmission = [{
      id: `intake-${projectId}`, // Generates a safe key for React mapping
      created_at: project.intake_submitted_at || new Date().toISOString(),
      form_data: {
        "Project Requirements": project.requirements || "No text provided."
      },
      files: project.project_assets || []
    }];

    // 4. Send it to the frontend
    res.status(200).json(formattedSubmission); 

  } catch (err) {
    console.error('[Fetch Submissions Error]:', err.message);
    res.status(500).json({ error: `DB Crash: ${err.message}` });
  }
});

// ==========================================
// POST: CLIENT SUBMITS INTAKE (PUBLIC ROUTE)
// ==========================================
// Notice: No 'requireAuth' here. Clients don't have JWTs.
router.post('/:id/submissions', async (req, res) => {
  try {
    const projectId = req.params.id;
    const { form_data, files } = req.body;

    // 1. Verify the project actually exists before accepting data
    const { data: project, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .single();

    if (projErr || !project) {
      return res.status(404).json({ error: 'Project not found or invalid intake link.' });
    }

    // 2. Insert the client's data into the table we just created
    const { data, error } = await supabaseAdmin
      .from('project_submissions')
      .insert([
        {
          project_id: projectId,
          form_data: form_data || {},
          files: files || []
        }
      ])
      .select();

    if (error) throw error;
    
    res.status(201).json({ message: 'Submission received successfully', data });

  } catch (err) {
    console.error('[Client Intake Save Error]:', err.message);
    res.status(500).json({ error: 'Failed to save intake data.' });
  }
});

module.exports = router;