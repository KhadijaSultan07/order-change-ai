const { crypto, sign, validShop } = require('./_session');

module.exports = async (req, res) => {
  const shop = String(req.query.shop || '').toLowerCase();
  if (!validShop(shop)) return res.status(400).json({ error: 'Enter a valid .myshopify.com store domain.' });
  if (!process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET || !process.env.APP_SESSION_SECRET) {
    return res.status(500).json({ error: 'Shopify connection is not configured in Vercel yet.' });
  }
  const state = crypto.randomBytes(24).toString('hex');
  const stateValue = `${shop}.${state}`;
  res.setHeader('Set-Cookie', `shopify_oauth_state=${stateValue}.${sign(stateValue)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const redirectUri = `${process.env.APP_URL}/api/auth/callback`;
  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set('client_id', process.env.SHOPIFY_CLIENT_ID);
  authorize.searchParams.set('scope', 'read_orders,write_orders,read_customers');
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', state);
  res.writeHead(302, { Location: authorize.toString() });
  res.end();
};
