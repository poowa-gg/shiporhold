import * as paypal from './paypal.js';
import * as store from './store.js';
import { verdictFor } from './verdict.js';

/** Pull the latest state from PayPal and update our record. PayPal is the source of truth. */
export async function refresh(id) {
  const inv = store.get(id);
  if (!inv) return null;
  const remote = await paypal.getInvoice(id);
  const status = remote.status;
  const due = remote.due_amount?.value;
  inv.status = status;
  inv.total = remote.amount?.value ?? inv.total;
  inv.paid = remote.payments?.paid_amount?.value ?? inv.paid ?? '0.00';
  inv.due = due ?? inv.due;
  inv.payerUrl = remote.detail?.metadata?.recipient_view_url || inv.payerUrl;
  inv.verdict = verdictFor(status, { due, currency: inv.currency });
  inv.updatedAt = new Date().toISOString();
  return store.put(inv);
}

export async function createInvoice(input) {
  const id = await paypal.createAndSendInvoice(input);
  const total = (Number(input.quantity) * Number(input.unitPrice)).toFixed(2);
  const now = new Date().toISOString();
  store.put({
    id, ...pick(input), total, paid: '0.00', due: total, status: 'SENT',
    verdict: verdictFor('SENT'), events: [], createdAt: now, updatedAt: now,
  });
  try { return await refresh(id); } catch { return store.get(id); }
}

const pick = ({ buyerName, buyerEmail, description, quantity, unitPrice, currency }) =>
  ({ buyerName, buyerEmail, description, quantity, unitPrice, currency });

/** Extract the invoice id from a webhook event without depending on one exact payload shape. */
export function invoiceIdFromEvent(event) {
  const r = event?.resource || {};
  const direct = r.invoice?.id || r.id;
  if (typeof direct === 'string' && direct.startsWith('INV')) return direct;
  const m = JSON.stringify(r).match(/INV2-[A-Z0-9-]+/);
  return m ? m[0] : null;
}

/** Handle a verified webhook event: log it, then re-read the invoice for the real status. */
export async function handleEvent(event) {
  if (!event?.id || store.seen(event.id)) return { ignored: 'duplicate or malformed' };
  store.markSeen(event.id);
  const id = invoiceIdFromEvent(event);
  const inv = id && store.get(id);
  if (!inv) return { ignored: 'unknown invoice' };
  inv.events = [...(inv.events || []), { type: event.event_type, at: new Date().toISOString() }].slice(-20);
  store.put(inv);
  await refresh(id);
  return { updated: id };
}
