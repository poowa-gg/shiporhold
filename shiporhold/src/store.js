import fs from 'node:fs';
import path from 'node:path';

// Tiny JSON-file store. Fine for a demo; swap for a database in production.
const FILE = process.env.STORE_FILE || path.join(process.cwd(), 'data', 'store.json');
const invoices = new Map();
const seenEvents = new Set();

try {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  for (const inv of saved.invoices || []) invoices.set(inv.id, inv);
  for (const id of saved.seenEvents || []) seenEvents.add(id);
} catch { /* first run */ }

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ invoices: [...invoices.values()], seenEvents: [...seenEvents].slice(-500) }, null, 2));
  } catch (e) { console.error('store write failed:', e.message); }
}

export const list = () => [...invoices.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const get = (id) => invoices.get(id);
export function put(inv) { invoices.set(inv.id, inv); persist(); return inv; }
export function seen(eventId) { return seenEvents.has(eventId); }
export function markSeen(eventId) { if (eventId) { seenEvents.add(eventId); persist(); } }
