/**
 * @fileoverview Enterprise Currency Conversion Service
 * @architecture Cached, Rate-Limit Protected, Cross-Currency Supported
 * * CRITICAL FIXES APPLIED (ISSUE #15):
 * - Merged conflicting implementations into a single, exported `getExchangeRate` function.
 * - Implemented Supabase caching via `upsert` to prevent API rate limit exhaustion.
 * - Added support for dynamic cross-currency calculations (e.g., NGN to GBP) using a USD base.
 * - Standardized the `node-fetch` dynamic import wrapper to prevent Node.js version crashes.
 */

const supabaseAdmin = require('../config/supabase');

// Safe fetch wrapper for CommonJS environments (Node < 18 fallback protection)
const fetchWrapper = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

/**
 * Retrieves the exchange rate between two currencies, utilizing a 24-hour database cache.
 * @param {string} fromCurrency - The currency code to convert from (e.g., 'NGN')
 * @param {string} toCurrency - The currency code to convert to (e.g., 'USD')
 * @returns {Promise<number>} - The conversion multiplier. Defaults to 1.0 on failure.
 */
const getExchangeRate = async (fromCurrency, toCurrency = 'USD') => {
  // 1. Base Case: Same currency requires no conversion
  if (fromCurrency === toCurrency) return 1.0;

  try {
    let rates = null;

    // 2. Query Cache: Look for USD-based rates less than 24 hours old
    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: cache, error: cacheErr } = await supabaseAdmin
      .from('exchange_rates')
      .select('rates, last_updated')
      .eq('base_code', 'USD')
      .gt('last_updated', staleThreshold)
      .maybeSingle();

    if (cache && cache.rates) {
      rates = cache.rates;
    } else {
      // 3. Cache Miss / Stale Data: Fetch fresh rates from ExchangeRate API
      const API_KEY = process.env.EXCHANGERATE_API_KEY;
      
      if (!API_KEY) {
        console.warn('[FX API Warning]: EXCHANGERATE_API_KEY missing. Defaulting to 1.0 parity to prevent system crash.');
        return 1.0;
      }

      const response = await fetchWrapper(`https://v6.exchangerate-api.com/v6/${API_KEY}/latest/USD`);
      const json = await response.json();

      if (json.result === 'success') {
        rates = json.conversion_rates;

        // 4. Update Cache using UPSERT
        // 'upsert' ensures that if the 'USD' row doesn't exist yet, it is created automatically.
        await supabaseAdmin
          .from('exchange_rates')
          .upsert({ 
            base_code: 'USD', 
            rates: rates, 
            last_updated: new Date().toISOString() 
          }, { onConflict: 'base_code' });
      } else {
        throw new Error(json['error-type'] || 'Upstream API rejected the rate request.');
      }
    }

    // 5. Cross-Currency Math Calculation
    // Since our cache is USD-based (e.g., 1 USD = 1500 NGN, 1 USD = 0.8 GBP):
    // To get NGN to GBP -> (1 / 1500) * 0.8 = 0.000533
    const rateFrom = rates[fromCurrency] || 1.0;
    const rateTo = rates[toCurrency] || 1.0;

    const multiplier = rateTo / rateFrom;
    
    // Return with a high-precision float (6 decimal places)
    return parseFloat(multiplier.toFixed(6));

  } catch (err) {
    console.error('[FX System Error]:', err.message);
    // CRITICAL FALLBACK: Always return 1.0 on failure so the invoicing pipeline doesn't throw a 500 error.
    return 1.0; 
  }
};

module.exports = { getExchangeRate };