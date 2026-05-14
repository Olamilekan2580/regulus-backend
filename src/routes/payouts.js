const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../config/supabase'); 

// POST /api/payouts/connect
router.post('/connect', async (req, res) => {
  const { org_id, payout_type, bank_code, account_number, routing_number, bank_name } = req.body;

  if (!org_id || !account_number) {
    return res.status(400).json({ error: 'Missing required banking parameters.' });
  }

  try {
    // 1. Fetch workspace details (FIXED: Using * to prevent missing column crashes)
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('*') 
      .eq('id', org_id)
      .single();

    if (orgError || !org) {
      return res.status(404).json({ error: 'Workspace not found in database.' });
    }

    // 2. Construct Flutterwave Payload
    const flwPayload = {
      business_name: org.name || `Regulus Workspace ${org_id.substring(0,6)}`,
      business_email: 'billing@regulus.io', // Hardcoded fallback since you don't have an email column
      account_number: account_number,
      business_contact_mobile: '09000000000', 
      business_mobile: '09000000000',
      split_type: 'percentage',
      split_value: 0.01 
    };

    if (payout_type === 'NGN') {
      flwPayload.account_bank = bank_code;
      flwPayload.country = 'NG';
    } else {
      // For USD (Payoneer/US Banks)
      flwPayload.account_bank = '090'; 
      flwPayload.country = 'US';
      flwPayload.meta = [
        { meta_name: "RoutingNumber", meta_value: routing_number },
        { meta_name: "BankName", meta_value: bank_name }
      ];
    }

    // 3. Fire request to Flutterwave
    const flwResponse = await axios.post(
      'https://api.flutterwave.com/v3/subaccounts',
      flwPayload,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const subaccountId = flwResponse.data.data.subaccount_id;

    // 4. Update the correct Multi-Currency columns in the database
    const updatePayload = {};
    if (payout_type === 'NGN') {
      updatePayload.fw_subaccount_ngn = subaccountId;
      updatePayload.ngn_bank_name = bank_name; // from the mapped array in Settings.jsx
      updatePayload.ngn_account_number = account_number;
    } else {
      updatePayload.fw_subaccount_usd = subaccountId;
      updatePayload.usd_bank_name = bank_name;
      updatePayload.usd_account_number = account_number;
    }

    const { error: updateError } = await supabase
      .from('organizations')
      .update(updatePayload)
      .eq('id', org_id);

    if (updateError) {
      console.error('Supabase Update Error:', updateError);
      return res.status(500).json({ error: 'Verified with Flutterwave, but failed to update local database.' });
    }

    return res.status(200).json({ success: true, subaccount_id: subaccountId });

  } catch (error) {
    console.error('Flutterwave API Error:', error.response?.data || error.message);
    const flwErrorMsg = error.response?.data?.message || 'Flutterwave verification failed.';
    return res.status(400).json({ error: flwErrorMsg });
  }
});

// PUT /api/payouts/default
// Master switch to determine which currency settles by default
router.put('/default', async (req, res) => {
  const { org_id, default_currency } = req.body;

  if (!['NGN', 'USD'].includes(default_currency)) {
    return res.status(400).json({ error: 'Invalid currency selection.' });
  }

  const { error } = await supabase
    .from('organizations')
    .update({ default_payout_currency: default_currency })
    .eq('id', org_id);

  if (error) {
    return res.status(500).json({ error: 'Failed to update default routing.' });
  }

  return res.status(200).json({ success: true });
});

module.exports = router;