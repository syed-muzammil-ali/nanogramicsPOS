const fs = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => value == null ? 'Not recorded' : `Rs ${Number(value).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function migrateInvoicePdf(db) {
  const columns = new Set((await db.queryRows('PRAGMA table_info(sales)')).map(c => c.name));
  for (const [name, type] of Object.entries({
    invoice_details_json: "TEXT DEFAULT '{}'", pdf_status: "TEXT DEFAULT 'pending'",
    pdf_filename: 'TEXT', pdf_error: 'TEXT', pdf_generated_at: 'TEXT'
  })) {
    if (!columns.has(name)) await db.exec(`ALTER TABLE sales ADD COLUMN ${name} ${type}`);
  }
}

function invoiceHtml(sale, items) {
  const details = JSON.parse(sale.invoice_details_json || '{}');
  const date = new Date(sale.created_at);
  const rows = items.map((item, index) => {
    const extra = details.items?.[index] || {};
    return `<tr><td><strong>${escape(item.product_name)}</strong><div class="muted">${escape([item.brand, item.type, extra.variant, extra.size].filter(Boolean).join(' / '))}</div><div class="muted">${escape(item.product_code)}</div></td><td class="number">${escape(item.qty)}</td><td class="number">${money(item.price)}</td><td class="number">${money(item.subtotal)}</td></tr>`;
  }).join('');
  const summary = [['Subtotal', sale.subtotal], ['Discount', sale.discount], ['Delivery / charges', sale.delivery], ['Tax', sale.tax], ['Grand total', sale.total]];
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
    @page { size: A4; margin: 16mm 14mm 18mm; }
    * { box-sizing: border-box; } body { font: 12px Arial, sans-serif; color: #171923; margin: 0; }
    header { border-top: 8px solid #f5c518; padding: 18px 0; border-bottom: 2px solid #171923; }
    h1 { font-size: 25px; margin: 0 0 6px; } h2 { margin: 0; font-size: 16px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 18px 0; line-height: 1.7; }
    .muted { color: #565e6b; font-size: 11px; } .number { text-align: right; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; } thead { display: table-header-group; }
    th { text-align: left; background: #171923; color: white; padding: 10px 8px; }
    td { padding: 10px 8px; border-bottom: 1px solid #dce0e5; vertical-align: top; }
    tr { break-inside: avoid; } td, .meta div, .notes { overflow-wrap: anywhere; }
    .totals { width: 55%; margin: 18px 0 0 auto; break-inside: avoid; }
    .totals div { display: flex; justify-content: space-between; gap: 15px; padding: 7px 9px; }
    .grand { background: #f5c518; font-size: 16px; font-weight: bold; }
    .payment { margin-top: 18px; padding: 12px; background: #f1f3f6; line-height: 1.8; break-inside: avoid; }
    .notes { margin-top: 14px; white-space: pre-wrap; } footer { margin-top: 22px; color: #565e6b; }
  </style></head><body>
  <header><h1>Lajpal Brand Hub</h1><h2>${sale.notes === 'WHOLESALE' ? 'WHOLESALE INVOICE' : 'INVOICE'} ${escape(sale.id)}</h2></header>
  <div class="meta"><div><strong>Customer</strong><br>${escape(details.customer_name || 'Walk-in')}${details.customer_phone ? '<br>' + escape(details.customer_phone) : ''}${details.customer_address ? '<br>' + escape(details.customer_address) : ''}</div>
  <div><strong>Date:</strong> ${escape(date.toLocaleDateString('en-GB'))}<br><strong>Time:</strong> ${escape(date.toLocaleTimeString('en-GB'))}<br><strong>Cashier:</strong> ${escape(details.cashier || sale.created_by_username || sale.cashier || `User ${sale.user_id || '-'}`)}</div></div>
  <table><colgroup><col style="width:46%"><col style="width:10%"><col style="width:22%"><col style="width:22%"></colgroup><thead><tr><th>Product / variant / size</th><th class="number">Qty</th><th class="number">Unit price</th><th class="number">Line total</th></tr></thead><tbody>${rows}</tbody></table>
  <section class="totals">${summary.map(([label, value]) => `<div class="${label === 'Grand total' ? 'grand' : ''}"><span>${label}</span><strong>${money(value ?? 0)}</strong></div>`).join('')}</section>
  <section class="payment"><strong>Payment method:</strong> ${escape(sale.payment_method || 'Not recorded')} &nbsp; <strong>Status:</strong> ${escape(sale.payment_status || 'Not recorded')}<br><strong>Cash received:</strong> ${money(details.cashReceived)}<br><strong>Change:</strong> ${money(sale.cashback ?? 0)}</section>
  ${sale.notes ? `<div class="notes"><strong>Notes</strong><br>${escape(sale.notes)}</div>` : ''}<footer>Thank you for shopping at Lajpal Brand Hub.<div style="margin-top:12px;line-height:1.6;break-inside:avoid">Software Developed by Nanogramics<br>nanogramics.tech</div></footer></body></html>`;
}

function pdfFilename(id) {
  const readable = String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'invoice';
  return `${readable}-${createHash('sha256').update(String(id)).digest('hex')}.pdf`;
}

class InvoicePdfService {
  constructor({ db, directory, renderPdf, logger = console }) {
    Object.assign(this, { db, directory, renderPdf, logger });
    this.inFlight = new Map();
    this.queue = Promise.resolve();
  }

  generate(id) {
    if (this.inFlight.has(id)) return this.inFlight.get(id);
    const task = this.queue.then(() => this.generateOne(id));
    this.queue = task.catch(() => {});
    this.inFlight.set(id, task);
    task.finally(() => this.inFlight.delete(id)).catch(() => {});
    return task;
  }

  async generateOne(id) {
    let temporary;
    try {
      const [sale] = await this.db.queryRows('SELECT * FROM sales WHERE id = ?', [id]);
      if (!sale) throw new Error('Invoice not found');
      const filename = pdfFilename(id);
      const destination = path.join(this.directory, filename);
      // A valid file also recovers a crash between atomic rename and status update.
      try {
        const existing = await fs.readFile(destination);
        if (existing.subarray(0, 5).toString() === '%PDF-') {
          await this.markReady(id, filename);
          return { success: true, filename };
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await this.db.exec("UPDATE sales SET pdf_status = 'generating', pdf_error = NULL WHERE id = ?", [id]);
      const items = await this.db.queryRows('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', [id]);
      const buffer = await this.renderPdf(invoiceHtml(sale, items));
      if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid invoice PDF output');
      await fs.mkdir(this.directory, { recursive: true });
      temporary = destination + '.tmp';
      await fs.writeFile(temporary, buffer);
      await fs.rename(temporary, destination);
      await this.markReady(id, filename);
      return { success: true, filename };
    } catch (error) {
      this.logger.error(`Invoice PDF failed for ${id}:`, error);
      if (temporary) await fs.unlink(temporary).catch(() => {});
      await this.db.exec("UPDATE sales SET pdf_status = 'failed', pdf_error = ? WHERE id = ?", [error.message, id]).catch(e => this.logger.error('Could not persist PDF failure:', e));
      return { success: false, error: error.message };
    }
  }

  markReady(id, filename) {
    return this.db.exec("UPDATE sales SET pdf_status = 'ready', pdf_filename = ?, pdf_error = NULL, pdf_generated_at = COALESCE(pdf_generated_at, ?) WHERE id = ?", [filename, new Date().toISOString(), id]);
  }

  async retryPending() {
    const rows = await this.db.queryRows("SELECT id FROM sales WHERE COALESCE(pdf_status, 'pending') != 'ready' ORDER BY created_at DESC");
    for (const { id } of rows) await this.generate(id);
  }
}

async function renderElectronPdf(BrowserWindow, html) {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  let timer;
  try {
    return await Promise.race([
      (async () => {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        return win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Invoice PDF generation timed out. Retry from Invoice PDFs.')), 30000); })
    ]);
  } catch (error) {
    // Electron navigation errors can include the entire invoice data URL.
    throw new Error(error.message.includes('data:text/html') ? 'Could not load invoice for PDF generation. Please retry.' : error.message);
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { InvoicePdfService, migrateInvoicePdf, invoiceHtml, pdfFilename, renderElectronPdf };
