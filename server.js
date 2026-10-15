import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from './src/config.js';
import * as store from './src/store.js';
import * as paypal from './src/paypal.js';
import { createInvoice, refresh, handleEvent } from './src/service.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

function readRaw(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function validate(b) {
  const errs = [];
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!b.buyerName?.trim()) errs.push('Buyer name is required');
  if (!email.test(b.buyerEmail || '')) errs.push('A valid buyer email is required (PayPal sends invoices by email)');
  if (!b.description?.trim()) errs.push('Description is required');
  if (!(Number(b.quantity) > 0)) errs.push('Quantity must be more than 0');
  if (!(Number(b.unitPrice) > 0)) errs.push('Price must be more than 0');
  if (!/^[A-Z]{3}$/.test(b.currency || '')) errs.push('Currency must be a 3-letter code like USD');
  return errs;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true });

    // PayPal webhook: verify the signature BEFORE trusting anything in the body.
    if (req.method === 'POST' && p === '/webhooks/paypal') {
      const raw = await readRaw(req);
      const ok = cfg.skipWebhookVerify ? true : await paypal.verifyWebhook(req.headers, raw);
      if (!ok) return send(res, 400, { error: 'signature verification failed' });
      let event;
      try { event = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid JSON' }); }
      send(res, 200, { received: true }); // answer fast, then process
      handleEvent(event).catch((e) => console.error('webhook handling failed:', e.message));
      return;
    }

    if (p === '/api/invoices' && req.method === 'GET') return send(res, 200, store.list());

    if (p === '/api/invoices' && req.method === 'POST') {
      const body = JSON.parse((await readRaw(req)) || '{}');
      const errs = validate(body);
      if (errs.length) return send(res, 400, { error: errs.join('. ') });
      return send(res, 201, await createInvoice(body));
    }

    const m = p.match(/^\/api\/invoices\/([^/]+)\/(refresh|mark-paid|mark-refunded|cancel)$/);
    if (m && req.method === 'POST') {
      const [, id, action] = m;
      const inv = store.get(id);
      if (!inv) return send(res, 404, { error: 'unknown invoice' });
      const body = JSON.parse((await readRaw(req)) || '{}');
      // "amount" lets the demo record a partial payment or refund.
      const amount = Number(body.amount) > 0 ? Number(body.amount) : Number(inv.total);
      if (action === 'mark-paid') await paypal.recordPayment(id, amount, inv.currency);
      if (action === 'mark-refunded') await paypal.recordRefund(id, amount, inv.currency);
      if (action === 'cancel') await paypal.cancelInvoice(id);
      return send(res, 200, await refresh(id));
    }

    // Static dashboard
    if (req.method === 'GET') {
      const file = path.join(PUBLIC, p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e.message);
    send(res, 500, { error: e.message });
  }
});

export { server };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(cfg.port, () => console.log(`ShipOrHold on http://localhost:${cfg.port} (PayPal: ${cfg.base})`));
}
