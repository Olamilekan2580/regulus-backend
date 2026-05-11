'use strict';

const puppeteer = require('puppeteer');

// Currency symbol map - keep in sync with frontend if you add more
const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  NGN: '₦',
  CAD: 'CA$',
};

/**
 * Formats a number as a currency string.
 * e.g. formatCurrency(1500, 'NGN') => '₦1,500.00'
 */
function formatCurrency(amount, currency = 'USD') {
  const symbol = CURRENCY_SYMBOLS[currency] || '$';
  const formatted = parseFloat(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}

/**
 * Formats a date string into a readable format.
 * e.g. formatDate('2025-01-15') => 'January 15, 2025'
 */
function formatDate(dateString) {
  if (!dateString) return 'Upon receipt';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'Upon receipt';
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Builds the HTML string for an invoice PDF.
 *
 * @param {object} invoice  - Invoice record from Supabase
 * @param {object} client   - Client record (name, email, company)
 * @param {string} orgName  - The agency/org name shown in the header
 * @param {object} branding - { primary: '#hex', accent: '#hex' }
 * @returns {string} Full HTML document string
 */
function buildInvoiceHTML(invoice, client, orgName = 'Regulus.', branding = {}) {
  const primaryColor = branding.primary || '#0A0F1E';
  const accentColor  = branding.accent  || '#00C896';
  const currency     = invoice.currency || 'USD';
  const symbol       = CURRENCY_SYMBOLS[currency] || '$';

  const clientName   = client.company || client.name || 'Unknown Client';
  const clientEmail  = client.email   || '';
  const dateIssued   = formatDate(invoice.created_at);
  const dueDate      = formatDate(invoice.due_date);
  const total        = formatCurrency(invoice.total, currency);

  const isPaid = invoice.status === 'Paid';
  const watermark = isPaid
    ? `<div class="watermark">PAID</div>`
    : '';

  // Build line items rows
  const lineItems = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  const lineItemRows = lineItems.length > 0
    ? lineItems.map((item) => {
        const qty   = parseFloat(item.quantity || 1);
        const rate  = parseFloat(item.rate || 0);
        const total = qty * rate;
        return `
          <tr>
            <td class="item-desc">${item.description || 'Service'}</td>
            <td class="item-num">${qty}</td>
            <td class="item-num">${formatCurrency(rate, currency)}</td>
            <td class="item-num item-total">${formatCurrency(total, currency)}</td>
          </tr>
        `;
      }).join('')
    : `
      <tr>
        <td class="item-desc">Professional Services</td>
        <td class="item-num">1</td>
        <td class="item-num">${total}</td>
        <td class="item-num item-total">${total}</td>
      </tr>
    `;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Invoice ${invoice.invoice_number}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: ${primaryColor};
          background: #ffffff;
          font-size: 14px;
          line-height: 1.5;
        }

        .page {
          width: 794px;          /* A4 at 96dpi */
          min-height: 1123px;
          padding: 60px;
          position: relative;
          overflow: hidden;
          background: #ffffff;
        }

        /* Watermark */
        .watermark {
          position: absolute;
          top: 42%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-45deg);
          font-size: 140px;
          font-weight: 900;
          color: ${isPaid ? 'rgba(0, 200, 150, 0.07)' : 'rgba(0,0,0,0.04)'};
          pointer-events: none;
          letter-spacing: 10px;
          white-space: nowrap;
          z-index: 0;
        }

        /* All content sits above watermark */
        .content {
          position: relative;
          z-index: 1;
        }

        /* ── Header ── */
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #f1f5f9;
          padding-bottom: 32px;
          margin-bottom: 48px;
        }

        .brand-name {
          font-size: 30px;
          font-weight: 900;
          color: ${primaryColor};
          letter-spacing: -0.02em;
        }

        .brand-sub {
          font-size: 12px;
          color: #64748b;
          margin-top: 4px;
          font-weight: 500;
        }

        .invoice-label {
          text-align: right;
        }

        .invoice-label .word {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: 0.06em;
          color: #cbd5e1;
          text-transform: uppercase;
        }

        .invoice-label .number {
          font-size: 16px;
          font-weight: 600;
          color: ${primaryColor};
          margin-top: 4px;
        }

        /* ── Meta (Billed to / Dates) ── */
        .meta {
          display: flex;
          justify-content: space-between;
          margin-bottom: 60px;
        }

        .meta-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #94a3b8;
          margin-bottom: 10px;
        }

        .meta-name {
          font-size: 18px;
          font-weight: 700;
          color: ${primaryColor};
        }

        .meta-email {
          font-size: 13px;
          color: #64748b;
          margin-top: 4px;
        }

        .meta-dates {
          text-align: right;
          display: flex;
          gap: 40px;
        }

        .date-block .date-value {
          font-size: 14px;
          font-weight: 600;
          color: #1e293b;
          white-space: nowrap;
        }

        /* ── Line Items Table ── */
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 48px;
        }

        thead tr {
          background: #f8fafc;
        }

        th {
          padding: 14px 16px;
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        th:first-child { text-align: left; border-radius: 8px 0 0 8px; }
        th:last-child  { text-align: right; border-radius: 0 8px 8px 0; }
        th.item-num    { text-align: right; }

        .item-desc {
          padding: 22px 16px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 14px;
          color: #1e293b;
          font-weight: 500;
        }

        .item-num {
          padding: 22px 16px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 14px;
          color: #475569;
          text-align: right;
        }

        .item-total {
          font-weight: 700;
          color: ${primaryColor};
        }

        /* ── Total Box ── */
        .total-wrapper {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 60px;
        }

        .total-box {
          background: ${isPaid ? '#f0fdf4' : '#f8fafc'};
          border: 1px solid ${isPaid ? '#bbf7d0' : '#e2e8f0'};
          padding: 32px 36px;
          border-radius: 16px;
          min-width: 300px;
        }

        .total-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 14px;
        }

        .total-row .label {
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
        }

        .total-row .value {
          font-size: 13px;
          font-weight: 600;
          color: ${primaryColor};
        }

        .total-divider {
          height: 1px;
          background: ${isPaid ? '#dcfce7' : '#e2e8f0'};
          margin: 14px 0;
        }

        .total-due-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
        }

        .total-due-label {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: ${isPaid ? '#166534' : '#94a3b8'};
        }

        .total-due-amount {
          font-size: 36px;
          font-weight: 900;
          color: ${isPaid ? '#16a34a' : primaryColor};
          letter-spacing: -0.02em;
        }

        /* ── Status Badge ── */
        .status-badge {
          display: inline-block;
          padding: 6px 16px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 24px;
          background: ${isPaid ? accentColor : '#e2e8f0'};
          color: ${isPaid ? '#fff' : '#64748b'};
        }

        /* ── Footer ── */
        .footer {
          position: absolute;
          bottom: 40px;
          left: 60px;
          right: 60px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid #f1f5f9;
          padding-top: 20px;
        }

        .footer-note {
          font-size: 11px;
          color: #94a3b8;
          font-weight: 500;
        }

        .footer-brand {
          font-size: 13px;
          font-weight: 900;
          color: ${primaryColor};
          opacity: 0.3;
        }
      </style>
    </head>
    <body>
      <div class="page">
        ${watermark}

        <div class="content">
          <!-- Header -->
          <div class="header">
            <div>
              <div class="brand-name">${orgName}</div>
              <div class="brand-sub">High-Performance Architecture</div>
            </div>
            <div class="invoice-label">
              <div class="word">Invoice</div>
              <div class="number">${invoice.invoice_number}</div>
            </div>
          </div>

          <!-- Status badge -->
          <span class="status-badge">${invoice.status || 'Draft'}</span>

          <!-- Meta -->
          <div class="meta">
            <div>
              <div class="meta-label">Billed To</div>
              <div class="meta-name">${clientName}</div>
              <div class="meta-email">${clientEmail}</div>
            </div>
            <div class="meta-dates">
              <div class="date-block">
                <div class="meta-label">Date Issued</div>
                <div class="date-value">${dateIssued}</div>
              </div>
              <div class="date-block">
                <div class="meta-label">Due Date</div>
                <div class="date-value">${dueDate}</div>
              </div>
            </div>
          </div>

          <!-- Line Items -->
          <table>
            <thead>
              <tr>
                <th style="text-align:left">Description</th>
                <th class="item-num">Qty / Hrs</th>
                <th class="item-num">Rate</th>
                <th class="item-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${lineItemRows}
            </tbody>
          </table>

          <!-- Total -->
          <div class="total-wrapper">
            <div class="total-box">
              <div class="total-row">
                <span class="label">Subtotal</span>
                <span class="value">${total}</span>
              </div>
              <div class="total-row">
                <span class="label">Tax</span>
                <span class="value">—</span>
              </div>
              <div class="total-divider"></div>
              <div class="total-due-row">
                <span class="total-due-label">Total Due</span>
                <span class="total-due-amount">${total}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="footer">
          <span class="footer-note">
            Thank you for your business. Payment is due by ${dueDate}.
          </span>
          <span class="footer-brand">${orgName}</span>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generates a PDF buffer for a given invoice.
 *
 * @param {object} invoice  - Invoice row from Supabase
 * @param {object} client   - Client row (name, email, company)
 * @param {string} orgName  - Agency name
 * @param {object} branding - { primary: '#hex', accent: '#hex' }
 * @returns {Promise<Buffer>} Raw PDF bytes
 *
 * @example
 * const pdf = await generateInvoicePDF(invoice, client, org.name, org.brand_settings);
 * res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${invoice.invoice_number}.pdf"` });
 * res.send(pdf);
 */
async function generateInvoicePDF(invoice, client, orgName, branding) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Important for Docker/EC2 environments
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    const html  = buildInvoiceHTML(invoice, client, orgName, branding);

    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    return pdfBuffer;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { generateInvoicePDF, buildInvoiceHTML };