const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const getExchangeRate = async (from, to = 'USD') => {
  const API_KEY = process.env.EXCHANGERATE_API_KEY;
  if (!API_KEY) return 1.0;

  try {
    const response = await fetch(`https://v6.exchangerate-api.com/v6/${API_KEY}/pair/${from}/${to}`);
    const data = await response.json();
    
    if (data.result === 'success') {
      return data.conversion_rate;
    }
    return 1.0;
  } catch (err) {
    console.error('FX API Error:', err.message);
    return 1.0;
  }
};

// backend/src/services/currencyService.js
const supabaseAdmin = require('../config/supabase');

const getCachedRate = async (fromCurrency) => {
  try {
    // 1. Check if we have rates from the last 24 hours
    const { data, error } = await supabaseAdmin
      .from('exchange_rates')
      .select('*')
      .gt('last_updated', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .single();

    if (data && data.rates[fromCurrency]) {
      return 1 / data.rates[fromCurrency]; // Reverse the rate to get TO USD
    }

    // 2. If not fresh, call the API
    const API_KEY = process.env.EXCHANGERATE_API_KEY;
    const response = await fetch(`https://v6.exchangerate-api.com/v6/${API_KEY}/latest/USD`);
    const json = await response.json();

    if (json.result === 'success') {
      // 3. Update the cache
      await supabaseAdmin
        .from('exchange_rates')
        .update({ rates: json.conversion_rates, last_updated: new Date().toISOString() })
        .eq('base_code', 'USD');

      return 1 / json.conversion_rates[fromCurrency];
    }

    return 1.0;
  } catch (err) {
    console.error('FX System Error:', err.message);
    return 1.0;
  }
};

module.exports = { getExchangeRate };