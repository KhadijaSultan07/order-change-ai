const crypto = require('crypto');

const ONE_HOUR = 60 * 60;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(value) {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) throw new Error('APP_SESSION_SECRET is missing');
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function encodeSession(session) {
  const payload = base64url(JSON.stringify({ ...session, expiresAt: Date.now() + ONE_HOUR * 1000 }));
  return `${payload}.${sign(payload)}`;
}

function decodeSession(cookieHeader = '') {
  const match = cookieHeader.match(/(?:^|; )shopify_session=([^;]+)/);
  if (!match) return null;
  const [payload, signature] = match[1].split('.');
  if (!payload || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return null;
  const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return session.expiresAt > Date.now() ? session : null;
}

function setCookie(res, value) {
  res.setHeader('Set-Cookie', `shopify_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ONE_HOUR}`);
}

function validShop(shop) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '');
}

module.exports = { crypto, decodeSession, encodeSession, setCookie, sign, validShop };
