const { crypto, encodeSession, setCookie, validShop } = require('../_session');

function cookieValue(header = '', name) {
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : null;
}

function safeEqual(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyShopifyHmac(query) {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map(key => `${key}=${Array.isArray(rest[key]) ? rest[key].join(',') : rest[key]}`)
    .join('&');

  const expected = crypto
    .createHmac('sha256', process.env.SHOPIFY_CLIENT_SECRET)
    .update(message)
    .digest('hex');

  return safeEqual(hmac, expected);
}

module.exports = async (req, res) => {
  const { shop, code, state } = req.query;
  const saved = cookieValue(req.headers.cookie, 'shopify_oauth_state');

  const separator = (saved || '').lastIndexOf('.');
  const savedValue = separator > 0 ? saved.slice(0, separator) : '';
  const savedSignature = separator > 0 ? saved.slice(separator + 1) : '';

  const stateMatches =
    savedValue &&
    savedSignature &&
    safeEqual(savedSignature, require('../_session').sign(savedValue)) &&
    savedValue === `${shop}.${state}`;

  if (!validShop(shop) || !code || !stateMatches || !verifyShopifyHmac(req.query)) {
    return res.status(401).send('Shopify authorization could not be verified.');
  }

  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      code
    })
  });

  const token = await tokenResponse.json();

  if (!tokenResponse.ok || !token.access_token) {
    return res.status(502).send('Shopify did not issue an access token.');
  }

  setCookie(res, encodeSession({ shop, accessToken: token.access_token }));
  res.writeHead(302, { Location: '/?connected=shopify' });
  res.end();
};
