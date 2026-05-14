const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../config/supabase'); // Adjust path if your supabase client is located elsewhere

// POST /api/payouts/connect
router.post('/connect', async (req, res) => {
  const { org_id, payout_type, bank_code, account_number, routing_number, bank_name } = req.body;

  if (!org_id || !account_number) {
    return res.status(400).json({ error: 'Missing required banking parameters.' });
  }

  try {
    // 1. Fetch workspace details
    // 1. Fetch the workspace details
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('*') // Changed to select everything to prevent missing column crashes
      .eq('id', org_id)
      .single();

    // THE DIAGNOSTIC RADAR
    console.log("==========================================");
    console.log("[PAYOUT CHECK] Target Org ID:", org_id);
    console.log("[PAYOUT CHECK] Database Error:", orgError);
    console.log("[PAYOUT CHECK] Database Result:", org);
    console.log("==========================================");

    if (orgError || !org) {
      return res.status(404).json({ error: 'Workspace not found in database.' });
    }

    // 2. Construct Flutterwave Payload
    const flwPayload = {
      business_name: org.name || `Freelance Workspace ${org_id.substring(0,6)}`,
      business_email: org.email || 'billing@yourdomain.com', 
      account_number: account_number,
      business_contact_mobile: '09000000000', 
      business_mobile: '09000000000',
      split_type: 'percentage',
      split_value: 0.01 
    };

    if (payout_type === 'NGN') {
      flwPayload.account_bank = bank_code;
      flwPayload.country = 'NG';
    } else if (payout_type === 'USD') {
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

    // 4. Save to Supabase
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        fw_subaccount_id: subaccountId,
        bank_name: payout_type === 'NGN' ? bank_code : bank_name,
        account_number: account_number
      })
      .eq('id', org_id);

    if (updateError) {
      console.error('Supabase Update Error:', updateError);
      return res.status(500).json({ error: 'Bank verified, but failed to save to database.' });
    }

    return res.status(200).json({ success: true, subaccount_id: subaccountId });

  } catch (error) {
    console.error('Flutterwave API Error:', error.response?.data || error.message);
    const flwErrorMsg = error.response?.data?.message || 'Failed to verify bank account with Flutterwave.';
    return res.status(400).json({ error: flwErrorMsg });
  }
});

module.exports = router;