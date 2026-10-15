import test from 'node:test';
import assert from 'node:assert/strict';
import { verdictFor } from '../src/verdict.js';

test('paid statuses are safe to deliver', () => {
  for (const s of ['PAID', 'MARKED_AS_PAID']) assert.equal(verdictFor(s).tone, 'ship');
});
test('pending and partial payments wait', () => {
  assert.match(verdictFor('PAYMENT_PENDING').word, /transit/i);
  const p = verdictFor('PARTIALLY_PAID', { due: '50.00', currency: 'USD' });
  assert.equal(p.tone, 'wait');
  assert.match(p.why, /50\.00 USD is still due/);
});
test('unpaid, cancelled and refunded never say ship', () => {
  for (const s of ['SENT', 'UNPAID', 'DRAFT', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'MARKED_AS_REFUNDED']) {
    assert.notEqual(verdictFor(s).tone, 'ship', s);
  }
});
test('unknown status fails safe', () => {
  assert.equal(verdictFor('SOMETHING_NEW').tone, 'hold');
  assert.equal(verdictFor(undefined).tone, 'hold');
});
