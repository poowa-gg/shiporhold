// Turns a PayPal invoice status into a plain Deliver / Hold answer.
// Pure function: no network, easy to test.
// Statuses are PayPal Invoicing v2 invoice statuses.

const V = (tone, word, why, message) => ({ tone, word, why, message });

export function verdictFor(status, { due, currency } = {}) {
  const dueText = due ? ` ${due} ${currency || ''} is still due.`.replace(/\s+\./, '.') : '';
  switch (status) {
    case 'PAID':
    case 'MARKED_AS_PAID':
      return V('ship', 'Safe to deliver',
        'Payment received in full. Go ahead and deliver the order or start the work.',
        "Hi! Your payment has come through, thank you. I'll start delivery now and keep you updated.");
    case 'PAYMENT_PENDING':
      return V('wait', 'Hold. Money in transit.',
        "The payment was made but hasn't cleared yet. Wait until it shows as paid.",
        "Hi! Thanks for paying. It hasn't cleared on my side yet, so I'll confirm as soon as it does and then get started.");
    case 'PARTIALLY_PAID':
      return V('wait', 'Hold the rest.',
        `Only part of the invoice is paid.${dueText} Do only what the payment covers.`,
        "Hi! I've received part of the payment, thank you. I'll begin the first part now and complete the rest once the balance comes through.");
    case 'DRAFT':
    case 'SCHEDULED':
    case 'SENT':
    case 'UNPAID':
      return V('wait', 'Hold. Not paid yet.',
        "The invoice has been sent but there's no payment yet. Don't deliver until it's paid.",
        'Hi! A friendly reminder about your invoice. Once payment comes through, I will get started right away.');
    case 'CANCELLED':
      return V('hold', 'Hold. Invoice cancelled.',
        'This invoice was cancelled, so nothing is owed. Check with the buyer before doing any work.',
        'Hi! Your invoice was cancelled. Let me know if you would like me to send a new one.');
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
    case 'MARKED_AS_REFUNDED':
      return V('hold', "Hold. Don't deliver.",
        'This payment was refunded, so the order is no longer fully paid. Check with the buyer first.',
        'Hi! I can see the payment for your order was refunded. Could you let me know what happened so we can sort it out?');
    default:
      return V('hold', 'Hold. Check PayPal.',
        `Unrecognised status${status ? ` "${status}"` : ''}. Check the invoice in PayPal before delivering.`,
        'Hi! I am just confirming the status of your payment and will get back to you shortly.');
  }
}
