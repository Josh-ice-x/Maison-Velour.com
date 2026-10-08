# Maison Velours

A storefront frontend with a small Express backend that forwards new orders to Telegram for fulfillment.

## How it works

- `maison-velours-updated.html` is a single-page storefront (product browsing, cart, wishlist, checkout form, order confirmation). It's served directly by the backend. Product images live in `assets/` (one JPEG per product, named after the product id) and are served at `/assets/`.
- `server.js` is a minimal Express server that:
  - Serves the storefront at `/`
  - Accepts order submissions at `POST /api/orders/telegram`
  - Validates and sanitizes the order payload
  - Forwards a formatted order summary to one or more Telegram chats via the Bot API
  - Exposes a `GET /health` endpoint for uptime checks

No payment processing happens on the backend — card details entered at checkout are validated client-side for format only (Luhn check, expiry, brand-specific length/CVV) and are **never sent to the server**. Only `name`, `email`, `address`, `zip`, `total`, and `items` are transmitted.

## Requirements

- Node.js 18+
- A Telegram bot token (create one via [@BotFather](https://t.me/BotFather))
- The chat ID(s) you want order notifications sent to

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from BotFather |
| `TELEGRAM_CHAT_IDS` | Yes | Comma-separated chat ID(s) to notify |
| `ALLOWED_ORIGINS` | Recommended | Comma-separated allowed origins for the order endpoint. Leave empty to disable origin checking (not recommended in production) |
| `PORT` | No | Defaults to `3000` |

## Running

```bash
npm start
```

The storefront will be available at `http://localhost:3000`.

## API

### `POST /api/orders/telegram`

Rate-limited to 20 requests per 15 minutes per client.

**Request body:**
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "address": "123 Main St",
  "zip": "10001",
  "total": 129.99,
  "items": [
    { "name": "Velvet Robe", "quantity": 1, "price": 129.99 }
  ]
}
```

**Response (success):**
```json
{ "ok": true, "successCount": 1, "failedCount": 0 }
```

**Response (failure):** `4xx`/`5xx` with `{ "ok": false, "error": "..." }`

### `GET /health`

Returns `{ "ok": true, "service": "maison-velours" }`.

## Deployment notes

- Set `ALLOWED_ORIGINS` in production to restrict which sites can call the order endpoint.
- Make sure `.env` is never committed — see `.gitignore`.
- The server sends a startup notification to configured Telegram chats when it boots.

## License

Private / all rights reserved (update as appropriate).
