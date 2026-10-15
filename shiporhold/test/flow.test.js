// Plumbing test against a MOCK PayPal. It proves our code, not PayPal's behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const state = { invoices: {}, verifyResult: 'SUCCESS', calls: [] };

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    state.calls.push(`${req.method} ${req.url}`);
    if (req.url === '/v1/oauth2/token') return j(200, { access_token: 't', expires_in: 3600 });
    if (req.url === '/v1/notifications/verify-webhook-signature') {
      JSON.parse(body); // must be valid JSON containing the raw event
      return j(200, { verification_status: state.verifyResult });
    }
    if (req.url === '/v2/invoicing/invoices' && req.method === 'POST') {
      const id = 'INV2-TEST-0001';
      const inv = JSON.parse(body);
      const total = inv.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_amount.value), 0).toFixed(2);
      state.invoices[id] = { status: 'DRAFT', amount: { value: total }, due_amount: { value: total }, payments: { paid_amount: { value: '0.00' } }, detail: { metadata: { recipient_view_url: 'https://example.test/pay' } } };
      return j(201, { rel: 'self', href: `http://mock/v2/invoicing/invoices/${id}`, method: 'GET' });
    }
    let m = req.url.match(/^\/v2\/invoicing\/invoices\/([^/]+)\/(send|payments|cancel)$/);
    if (m) {
      const inv = state.invoices[m[1]];
      if (m[2] === 'send') inv.status = 'SENT';
      if (m[2] === 'cancel') inv.status = 'CANCELLED';
      if (m[2] === 'payments') {
        const paid = Number(JSON.parse(body).amount.value);
        const total = Number(inv.amount.value);
        inv.payments.paid_amount.value = paid.toFixed(2);
        inv.due_amount.value = (total - paid).toFixed(2);
        inv.status = paid >= total ? 'PAID' : 'PARTIALLY_PAID';
      }
      return j(200, {});
    }
    m = req.url.match(/^\/v2\/invoicing\/invoices\/([^/]+)$/);
    if (m && req.method === 'GET') return j(200, { id: m[1], ...state.invoices[m[1]] });
    j(404, { message: 'not found' });
  });
});

let app, base;
test.before(async () => {
  await new Promise((r) => mock.listen(0, r));
  process.env.PAYPAL_BASE = `http://localhost:${mock.address().port}`;
  process.env.PAYPAL_CLIENT_ID = 'id';
  process.env.PAYPAL_CLIENT_SECRET = 'secret';
  process.env.PAYPAL_WEBHOOK_ID = 'WH-1';
  process.env.STORE_FILE = path.join(os.tmpdir(), `shiporhold-${Date.now()}.json`);
  ({ server: app } = await import('../server.js'));
  await new Promise((r) => app.listen(0, r));
  base = `http://localhost:${app.address().port}`;
});
test.after(() => { mock.close(); app.close(); });

const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
const getList = async () => (await fetch(base + '/api/invoices')).json();
const tick = () => new Promise((r) => setTimeout(r, 80));

const order = { buyerName: 'Tolu Ade', buyerEmail: 'tolu@example.com', description: '20 bags', quantity: 20, unitPrice: 10, currency: 'USD' };

test('rejects invalid orders', async () => {
  const r = await post('/api/invoices', { ...order, buyerEmail: 'nope' });
  assert.equal(r.status, 400);
});

test('create sends invoice and says hold', async () => {
  const r = await post('/api/invoices', order);
  assert.equal(r.status, 201);
  const inv = await r.json();
  assert.equal(inv.id, 'INV2-TEST-0001');
  assert.equal(inv.total, '200.00');
  assert.equal(inv.verdict.tone, 'wait');
  assert.ok(state.calls.some((c) => c.endsWith('/send')));
});

test('webhook with bad signature is rejected', async () => {
  state.verifyResult = 'FAILURE';
  const r = await post('/webhooks/paypal', { id: 'WH-EVT-0', event_type: 'INVOICING.INVOICE.PAID', resource: {} });
  assert.equal(r.status, 400);
  state.verifyResult = 'SUCCESS';
});

test('partial payment then full payment flips the verdict via webhook', async () => {
  await post('/api/invoices/INV2-TEST-0001/mark-paid', { amount: 50 });
  assert.equal((await getList())[0].verdict.word, 'Hold the rest.');

  // Full payment recorded at PayPal, then PayPal notifies us.
  state.invoices['INV2-TEST-0001'].status = 'PAID';
  state.invoices['INV2-TEST-0001'].payments.paid_amount.value = '200.00';
  const evt = { id: 'WH-EVT-1', event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: 'INV2-TEST-0001' } } };
  assert.equal((await post('/webhooks/paypal', evt)).status, 200);
  await tick();
  const inv = (await getList())[0];
  assert.equal(inv.verdict.tone, 'ship');
  assert.equal(inv.events.at(-1).type, 'INVOICING.INVOICE.PAID');
});

test('duplicate webhook events are ignored', async () => {
  const before = (await getList())[0].events.length;
  await post('/webhooks/paypal', { id: 'WH-EVT-1', event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: 'INV2-TEST-0001' } } });
  await tick();
  assert.equal((await getList())[0].events.length, before);
});

test('webhook finds the invoice id even with a different payload shape', async () => {
  state.invoices['INV2-TEST-0001'].status = 'CANCELLED';
  const evt = { id: 'WH-EVT-2', event_type: 'INVOICING.INVOICE.CANCELLED', resource: { href: 'https://api-m.paypal.com/v2/invoicing/invoices/INV2-TEST-0001' } };
  await post('/webhooks/paypal', evt);
  await tick();
  assert.equal((await getList())[0].verdict.tone, 'hold');
});
