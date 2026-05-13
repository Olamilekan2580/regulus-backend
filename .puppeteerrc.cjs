const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Forces Puppeteer to download Chrome directly into the project directory
  // so Render bundles it with the live deployment.
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};