const axios = require('axios');

const errorHandler = (err, req, res, next) => {
  console.error(`[SYSTEM ERROR] ${err.message}`);

  // Fire telemetry to Telegram in the background (do not block the response)
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const message = `🚨 *Regulus Crash Report*\n\n*Endpoint:* ${req.method} ${req.url}\n*Error:* ${err.message}\n*IP:* ${req.ip}\n*Time:* ${new Date().toISOString()}`;
    
    axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown'
    }).catch(e => console.error('[TELEMETRY FAILED]', e.message));
  }

  // Send generic response to the client
  res.status(500).json({ error: 'Internal Server Error. The engineering team has been notified.' });
};

module.exports = { errorHandler };