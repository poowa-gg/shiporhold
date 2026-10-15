# ShipOrHold

Turn a chat order into a PayPal invoice, then get a plain **Deliver or Hold** answer from the invoice's live payment status.

Built for the PayPal AI Hackathon. **Sandbox only: no real money moves.**

## What works today
- Create and send a PayPal invoice (Invoicing API v2).
- Receive PayPal webhooks, verify their signature with PayPal, ignore duplicates.
- Re-read the invoice from PayPal on every event, so the verdict comes from PayPal's real status (paid, partly paid, payment pending, cancelled, refunded).
- Dashboard with the verdict, a suggested message to the buyer, and demo buttons (record payment, refund, cancel).

## Not built yet
- AI that reads a pasted WhatsApp message or voice note and drafts the invoice.
- Fee and speed comparison across payment methods.
- Dispute handling (PayPal sends disputes as separate events).
- Seller sign-in / "Connect PayPal" (this demo uses one sandbox merchant account).

## Run it
Needs Node 20 or newer. No dependencies to install.

1. In the PayPal developer dashboard, create a **sandbox** REST app and copy its Client ID and Secret. Use a sandbox **business** account as the seller, and a sandbox **personal** account as the buyer.
2. `cp .env.example .env` and fill in the client ID and secret.
3. `npm run dev` and open http://localhost:3000
4. Create an invoice using your sandbox buyer's email. Open the invoice page and pay it with the sandbox buyer, or use the demo buttons.

## Webhooks
PayPal can only reach a public URL, so deploy first (for example on Render) or use a tunnel.
1. In the developer dashboard, add a webhook pointing to `https://YOUR-URL/webhooks/paypal`.
2. Subscribe to the invoicing events: created, scheduled, updated, paid, cancelled, refunded.
3. Copy the **Webhook ID** into `PAYPAL_WEBHOOK_ID`.

Without a valid webhook ID, webhooks are rejected. `SKIP_WEBHOOK_VERIFY=true` is for local testing only and is ignored when `NODE_ENV=production`.

## Deploy on Render
Create a Web Service from this repo. Build command: none. Start command: `npm start`. Add the env vars from `.env.example` and set `NODE_ENV=production`. The JSON-file store resets on redeploy, which is fine for a demo.

## Tests
`npm test` runs the verdict logic and the webhook flow against a **mock** PayPal. They check our code, not PayPal's behaviour. Run a real sandbox invoice end to end before relying on it.

## License
MIT
