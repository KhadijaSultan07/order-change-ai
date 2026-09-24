const { decodeSession } = require('./_session');

module.exports = async (req, res) => {
  const session = decodeSession(req.headers.cookie);
  const name = String(req.query.order || '').replace(/^#/, '').trim();
  if (!session) return res.status(401).json({ error: 'Connect Shopify first.' });
  if (!name) return res.status(400).json({ error: 'Enter an order number.' });

  const query = `query GetOrder($query: String!) { orders(first: 1, query: $query) { nodes { id name createdAt displayFinancialStatus displayFulfillmentStatus note totalPriceSet { shopMoney { amount currencyCode } } customer { firstName lastName email phone } shippingAddress { address1 address2 city province zip country } lineItems(first: 10) { nodes { id title sku quantity originalUnitPriceSet { shopMoney { amount currencyCode } } } } } } }`;
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
  const lineItems = order.lineItems.nodes.map(item => ({ ...item, unitPrice: Number(item.originalUnitPriceSet?.shopMoney?.amount || 0), currency: item.originalUnitPriceSet?.shopMoney?.currencyCode }));
  res.status(200).json({ order: { id: order.id, name: order.name, createdAt: order.createdAt, financialStatus: order.displayFinancialStatus, fulfillmentStatus: order.displayFulfillmentStatus, note: order.note, customer: order.customer, shippingAddress: order.shippingAddress, lineItems, total: Number(order.totalPriceSet?.shopMoney?.amount || 0), currency: order.totalPriceSet?.shopMoney?.currencyCode, sku: firstLine.sku } });
};
