const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabase');

const authModule = require('../middleware/auth');
const requireAuth = typeof authModule === 'function' ? authModule : authModule.requireAuth;

router.use(requireAuth);

router.post('/analyze', async (req, res) => {
  const orgId = req.headers['x-org-id'];
  if (!orgId) return res.status(400).json({ error: 'Organization context missing' });

  const { contract_text } = req.body;
  if (!contract_text) return res.status(400).json({ error: 'No contract text provided' });

  try {
    // We are using Groq for ultra-fast Llama 3 inference
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192', // Fast, high-context model
        messages: [
          {
            role: 'system',
            content: `You are an elite Tech Lawyer advising a Cloud-Native Systems Architect. 
            Analyze the provided freelance contract. Look for toxic clauses regarding: 
            1. Scope Creep (lack of clear boundaries)
            2. Unlimited Revisions
            3. IP Assignment (giving away pre-existing tools/code)
            4. Unreasonable Liability/Indemnification for bugs or server downtime.
            
            Return ONLY a raw JSON array. Do not wrap it in markdown. Do not add conversational text.
            Format: [{"clause": "exact problematic text", "risk": "High|Medium", "reason": "why this is dangerous", "counter_proposal": "legal text to replace it with"}]`
          },
          {
            role: 'user',
            content: contract_text
          }
        ],
        temperature: 0.1, // Keep it deterministic and factual
        response_format: { type: "json_object" } // Force JSON output
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to communicate with AI provider');
    }

    // Extract and parse the JSON string from the LLM
    const content = data.choices[0].message.content;
    let flags = [];
    
    try {
      // Sometimes LLMs wrap JSON objects in a root key if forced to JSON mode
      const parsed = JSON.parse(content);
      flags = Array.isArray(parsed) ? parsed : (parsed.flags || parsed.clauses || Object.values(parsed)[0]);
    } catch (parseErr) {
      console.error('JSON Parse Error:', content);
      throw new Error('AI returned malformed legal analysis.');
    }

    res.status(200).json({ flags });

  } catch (err) {
    console.error('[Contract Analysis Error]:', err.message);
    res.status(500).json({ error: 'Failed to analyze contract' });
  }
});

module.exports = router;