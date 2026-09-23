const { decodeSession } = require('./_session');

module.exports = async (req, res) => {
  const session = decodeSession(req.headers.cookie);
  const name = String(req.query.order || '').replace(/^#/, '').trim();
  if (!session) return res.status(401).json({ error: 'Connect Shopify first.' });
  if (!name) return res.status(400).json({ error: 'Enter an order number.' });

  const query = `query GetOrder($query: String!) { orders(first: 1, query: $query) { nodes { name displayFinancialStatus displayFulfillmentStatus note customer { firstName lastName email } shippingAddress { address1 city province zip country } lineItems(first: 5) { nodes { title sku quantity } } } } }`;
  const response = await fetch(`https://${session.shop}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
    body: JSON.stringify({ query, variables: { query: `name:${name}` } })
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) return res.status(502).json({ error: 'Shopify order lookup failed.' });
  const order = payload.data.orders.nodes[0];
  if (!order) return res.status(404).json({ error: `Order #${name} was not found.` });
  const firstLine = order.lineItems.nodes[0] || {};
  res.status(200).json({ order: { name: order.name, financialStatus: order.displayFinancialStatus, fulfillmentStatus: order.displayFulfillmentStatus, note: order.note, customer: order.customer, shippingAddress: order.shippingAddress, lineItems: order.lineItems.nodes, sku: firstLine.sku } });
};
