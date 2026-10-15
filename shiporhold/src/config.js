const env = process.env;

export const cfg = {
  port: Number(env.PORT || 3000),
  base: (env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com').replace(/\/$/, ''),
  clientId: env.PAYPAL_CLIENT_ID || '',
  clientSecret: env.PAYPAL_CLIENT_SECRET || '',
  webhookId: env.PAYPAL_WEBHOOK_ID || '',
  invoicerName: env.INVOICER_NAME || '',
  invoicerEmail: env.INVOICER_EMAIL || '',
  production: env.NODE_ENV === 'production',
  // Escape hatch for local testing only. Never honoured in production.
  skipWebhookVerify: env.SKIP_WEBHOOK_VERIFY === 'true' && env.NODE_ENV !== 'production',
};

export function assertConfigured() {
  const missing = [];
  if (!cfg.clientId) missing.push('PAYPAL_CLIENT_ID');
  if (!cfg.clientSecret) missing.push('PAYPAL_CLIENT_SECRET');
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
}
