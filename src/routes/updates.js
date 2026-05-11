/**
 * @fileoverview Universal Entity Status Mutation Engine
 * @architecture Multi-tenant, RBAC Secured, State-Machine Enforced
 * * CRITICAL FIXES APPLIED (ISSUE #10):
 * 1. Scoping Leak Resolved: Ripped out `freelancer_id`. Enforces strict `org_id` segregation.
 * 2. State Machine Enforcement: Projects, Invoices, and Proposals now have strictly validated, distinct status maps.
 * 3. Granular RBAC: Members can update Projects, but ONLY Admins/Owners can mutate Financial Documents (Invoices/Proposals).
 * 4. UUID Validation: Prevents malformed queries from crashing the PostgreSQL execution planner.
 */

const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');
const { requireAuth, requireOrgMember } = require('../middleware/auth');

// ==========================================
// 🛡️ STATE MACHINE & VALIDATION CONSTANTS
// ==========================================

// Defines exactly which tables are exposed to this universal mutation route.
const ALLOWED_ENTITIES = ['projects', 'invoices', 'proposals'];

// Enforces strict status dictionaries based on the entity type.
// A user cannot set a Project status to "Paid", nor an Invoice to "In Progress".
const ENTITY_STATUS_MAPS = {
  projects: ['Draft', 'Active', 'On Hold', 'Completed', 'Archived'],
  invoices: ['Draft', 'Sent', 'Paid', 'Overdue', 'Void', 'Refunded'],
  proposals: ['Draft', 'Sent', 'Approved', 'Rejected', 'Expired']
};

/**
 * Validates UUID v4 format to prevent Postgres SQL injection or execution crashes.
 * @param {string} uuid 
 * @returns {boolean}
 */
const isValidUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

// ==========================================
// 🛡️ GLOBAL ROUTE SECURITY
// ==========================================
// 1. Ensure the user is cryptographically authenticated.
router.use(requireAuth);
// 2. Ensure the user actually belongs to the workspace they are trying to mutate.
router.use(requireOrgMember); // Injects req.orgRole and req.headers['x-org-id']

// ==========================================
// ⚙️ THE MUTATION PIPELINE
// ==========================================

/**
 * PUT /:entity/:id
 * Universal endpoint to transition the 'status' column of supported entities.
 */
router.put('/:entity/:id', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  const { entity, id } = req.params;
  const { status } = req.body;
  const userRole = req.orgRole; // Inherited from requireOrgMember middleware

  // ---------------------------------------------------------
  // PHASE 1: PRE-FLIGHT VALIDATION
  // ---------------------------------------------------------

  // 1A. Entity Validation
  if (!ALLOWED_ENTITIES.includes(entity)) {
    console.warn(`[SECURITY] User ${req.user.id} attempted to mutate locked table: ${entity}`);
    return res.status(403).json({ 
      error: 'Security Exception',
      message: `Mutation engine locked. Entity [${entity}] is not exposed for universal updates.` 
    });
  }

  // 1B. Identifier Validation
  if (!id || !isValidUUID(id)) {
    return res.status(400).json({ error: 'Malformed resource identifier. Must be a valid UUIDv4.' });
  }

  // 1C. Status Payload Validation
  if (!status || typeof status !== 'string') {
    return res.status(400).json({ error: 'Missing or malformed target status in request payload.' });
  }

  // 1D. State Machine Verification (Ensures status matches the specific entity)
  const allowedStatuses = ENTITY_STATUS_MAPS[entity];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ 
      error: 'State Machine Violation',
      message: `Invalid status [${status}] for entity [${entity}]. Permitted values: ${allowedStatuses.join(', ')}.`
    });
  }

  // ---------------------------------------------------------
  // PHASE 2: ROLE-BASED ACCESS CONTROL (RBAC)
  // ---------------------------------------------------------
  
  // Financial documents require elevated privileges to mutate their status manually.
  // Standard members can update Project states, but not Invoices or Proposals.
  const isFinancialEntity = ['invoices', 'proposals'].includes(entity);
  
  if (isFinancialEntity && userRole === 'member') {
    return res.status(403).json({ 
      error: 'Insufficient Privileges',
      message: 'Financial state mutations require Administrator or Owner access levels.' 
    });
  }

  // ---------------------------------------------------------
  // PHASE 3: DATABASE EXECUTION & TELEMETRY
  // ---------------------------------------------------------

  try {
    const { data, error } = await supabaseAdmin
      .from(entity)
      .update({ 
        status: status,
        updated_at: new Date().toISOString() // Explicit audit timestamping
      })
      .eq('id', id)
      .eq('org_id', orgId) // 🔒 THE FIX: Strict Tenant Segregation overrides freelancer_id
      .select()
      .single();

    if (error) {
      // PGRST116 means the row wasn't found OR the org_id didn't match (Silent Fail Protection)
      if (error.code === 'PGRST116') {
        return res.status(404).json({ 
          error: 'Resource Resolution Failed',
          message: `The requested ${entity} record does not exist within this workspace boundary.` 
        });
      }
      throw error;
    }

    // System Telemetry & Audit Logging
    console.log(`[MUTATION SUCCESS] Org: ${orgId} | Entity: ${entity.toUpperCase()} | ID: ${id} | New State: ${status} | Operator: ${req.user.id}`);

    res.status(200).json({
      message: `State transition to [${status}] completed successfully.`,
      data: data
    });

  } catch (err) {
    console.error(`[FATAL MUTATION ERROR - ${entity.toUpperCase()}]:`, err.message);
    res.status(500).json({ 
      error: 'Database Execution Failed',
      message: 'The persistence layer rejected the status mutation.' 
    });
  }
});

module.exports = router;