const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

router.use(requireAuth);

router.post('/analyze', async (req, res) => {
  // ROBUST CONTEXT: Look in headers OR body
  const orgId = req.headers['x-org-id'] || req.body.org_id;
  
  if (!orgId) {
    return res.status(400).json({ error: 'Organization context missing. Please refresh.' });
  }

  const { contract_text } = req.body;
  if (!contract_text || contract_text.length < 50) {
    return res.status(400).json({ error: 'Contract text is too short to audit.' });
  }

  // Defensive Check: Ensure API Key exists
  if (!process.env.GROQ_API_KEY) {
    console.error('[Configuration Error]: GROQ_API_KEY is missing from environment variables.');
    return res.status(500).json({ error: 'AI Audit service is currently misconfigured.' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192', 
        messages: [
          {
            role: 'system',
            content: `You are an elite Tech Lawyer advising a Cloud-Native Systems Architect. 
            Analyze the provided freelance contract for toxic clauses: 
            1. Scope Creep (unclear boundaries)
            2. Unlimited Revisions
            3. IP Assignment (giving away pre-existing tools/logic)
            4. Unreasonable Liability (indemnification for cloud outages).
            
            Return ONLY a raw JSON object with a "flags" key containing the array. 
            No markdown, no conversation.
            Schema: {"flags": [{"clause": "string", "risk": "High|Medium", "reason": "string", "counter_proposal": "string"}]}`
          },
          {
            role: 'user',
            content: contract_text
          }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" } 
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('[Groq API Error]:', data.error?.message);
      throw new Error('AI provider rejected the request.');
    }

    // Extract and Robustly Parse Content
    const content = data.choices[0].message.content;
    let flags = [];
    
    try {
      const parsed = JSON.parse(content);
      // Handle various LLM output structures
      flags = parsed.flags || (Array.isArray(parsed) ? parsed : Object.values(parsed)[0]);
      
      if (!Array.isArray(flags)) throw new Error('Parsed flags is not an array');
    } catch (parseErr) {
      console.error('[AI Format Error]: Malformed JSON from LLM', content);
      throw new Error('AI returned an unreadable legal analysis.');
    }

    // Success
    res.status(200).json({ flags });

  } catch (err) {
    console.error('[Contract Analysis Exception]:', err.message);
    res.status(500).json({ error: err.message || 'Audit engine failed.' });
  }
});

module.exports = router;