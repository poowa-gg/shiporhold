import { randomUUID } from 'node:crypto';
import { cfg, assertConfigured } from './config.js';

let tokenCache = { value: null, expiresAt: 0 };

async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.value;
  assertConfigured();
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetch(`${cfg.base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${data.error_description || data.error || 'unknown'}`);
  tokenCache = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.value;
}

async function pp(path, { method = 'GET', body, requestId } = {}) {
  const headers = { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' };
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  const res = await fetch(`${cfg.base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const detail = data.details?.map((d) => d.description || d.issue).join('; ');
    throw new Error(`PayPal ${method} ${path} failed (${res.status}): ${data.message || data.name || 'error'}${detail ? ` - ${detail}` : ''}`);
  }
  return data;
}

const money = (n) => Number(n).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

/** Create a draft invoice, send it, and return its id. */
export async function createAndSendInvoice({ buyerName, buyerEmail, description, quantity, unitPrice, currency }) {
  const [given, ...rest] = buyerName.trim().split(/\s+/);
  const invoice = {
    detail: { currency_code: currency, note: 'Thank you for your order.' },
    primary_recipients: [{
      billing_info: { name: { given_name: given, surname: rest.join(' ') || '-' }, email_address: buyerEmail },
    }],
    items: [{
      name: description,
      quantity: String(quantity),
      unit_amount: { currency_code: currency, value: money(unitPrice) },
    }],
  };
  if (cfg.invoicerName || cfg.invoicerEmail) {
    invoice.invoicer = {};
    if (cfg.invoicerName) invoice.invoicer.name = { business_name: cfg.invoicerName };
    if (cfg.invoicerEmail) invoice.invoicer.email_address = cfg.invoicerEmail;
  }
  const created = await pp('/v2/invoicing/invoices', { method: 'POST', body: invoice, requestId: randomUUID() });
  // The create call returns a link to the new invoice; take the id from it.
  const id = created.id || String(created.href || '').split('/').pop();
  if (!id) throw new Error('PayPal did not return an invoice id');
  await pp(`/v2/invoicing/invoices/${id}/send`, {
    method: 'POST',
    body: { send_to_recipient: true, send_to_invoicer: false },
  });
  return id;
}

export const getInvoice = (id) => pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}`);

/** Record an offline payment (bank transfer etc). Triggers an INVOICING.INVOICE.PAID webhook. */
export const recordPayment = (id, amount, currency, method = 'BANK_TRANSFER') =>
  pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/payments`, {
    method: 'POST',
    body: { method, payment_date: today(), amount: { currency_code: currency, value: money(amount) }, note: 'Recorded in ShipOrHold' },
  });

export const recordRefund = (id, amount, currency, method = 'BANK_TRANSFER') =>
  pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/refunds`, {
    method: 'POST',
    body: { method, refund_date: today(), amount: { currency_code: currency, value: money(amount) } },
  });

export const cancelInvoice = (id) =>
  pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { send_to_invoicer: false, send_to_recipient: true, subject: 'Invoice cancelled', note: 'This invoice was cancelled by the seller.' },
  });

/**
 * Verify a webhook with PayPal. rawBody must be the exact string PayPal sent.
 * Returns true only when PayPal says SUCCESS.
 */
export async function verifyWebhook(headers, rawBody) {
  if (!cfg.webhookId) return false;
  const h = (k) => JSON.stringify(headers[k] ?? '');
  // Embed the raw body untouched so re-serialisation can't break the signature.
  const payload =
    `{"auth_algo":${h('paypal-auth-algo')},"cert_url":${h('paypal-cert-url')},` +
    `"transmission_id":${h('paypal-transmission-id')},"transmission_sig":${h('paypal-transmission-sig')},` +
    `"transmission_time":${h('paypal-transmission-time')},"webhook_id":${JSON.stringify(cfg.webhookId)},` +
    `"webhook_event":${rawBody}}`;
  const res = await fetch(`${cfg.base}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: payload,
  });
  const data = await res.json().catch(() => ({}));
  return res.ok && data.verification_status === 'SUCCESS';
}
