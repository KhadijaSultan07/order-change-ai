const platforms = document.querySelectorAll('.platform-card');
const steps = document.querySelectorAll('.step');
const form = document.querySelector('#requestForm');
const resultGrid = document.querySelector('#resultGrid');
const emptyState = document.querySelector('#emptyState');
const status = document.querySelector('#requestStatus');
const helpDialog = document.querySelector('#helpDialog');
const formNote = document.querySelector('#formNote');
const requestQueue = document.querySelector('#requestQueue');
let activeRequestId = null;

const params = new URLSearchParams(window.location.search);
const shopifyConnected = params.get('connected') === 'shopify';

if (shopifyConnected) {
  const shopifyCard = document.querySelector('#shopifyConnect');
  shopifyCard.classList.add('connected');
  shopifyCard.querySelector('em').textContent = 'Connected';
  formNote.textContent = 'Shopify connected for this browser session. Analyze #1001 to fetch the real test order.';
  window.history.replaceState({}, document.title, window.location.pathname);
}

platforms.forEach((card) => card.addEventListener('click', () => {
  if (card.dataset.platform === 'Shopify') {
    const shop = window.prompt('Enter your Shopify store domain', 'kai-order-change-demo.myshopify.com');
    if (shop) window.location.href = `/api/auth?shop=${encodeURIComponent(shop.trim())}`;
    return;
  }
  card.classList.toggle('connected');
  card.querySelector('em').textContent = card.classList.contains('connected') ? 'Connected' : 'Connect';
  document.querySelector('#platformSelect').value = card.dataset.platform === 'WhatsApp' ? 'Manual order' : card.dataset.platform;
}));

requestQueue.addEventListener('click', (event) => {
  const item = event.target.closest('.queue-item');
  if (!item) return;
  document.querySelectorAll('.queue-item').forEach((queueItem) => queueItem.classList.toggle('selected', queueItem === item));
  document.querySelector('#orderId').value = item.dataset.order;
  document.querySelector('#requestText').value = item.dataset.request;
  status.textContent = `${item.dataset.source} request selected`;
  formNote.textContent = 'Review this request against the connected Shopify order. The order is never changed until approval.';
  document.querySelector('.request-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.querySelector('#newRequestButton').addEventListener('click', () => {
  document.querySelector('#orderId').value = '';
  document.querySelector('#sku').value = '';
  document.querySelector('#requestText').value = '';
  document.querySelector('#requestText').focus();
  status.textContent = 'New request';
  document.querySelector('.request-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.querySelector('#resetConnections').addEventListener('click', () => platforms.forEach((card) => {
  card.classList.remove('connected'); card.querySelector('em').textContent = 'Connect';
}));

function requestType(request) {
  if (/address|delivery/i.test(request)) return 'address_change';
  if (/cancel/i.test(request)) return 'cancel_order';
  if (/remove|refund/i.test(request)) return 'remove_item';
  const quantityMatch = request.match(/(?:from\s*)?(\d+)\s*(?:to|→)\s*(\d+)/i);
  if (quantityMatch) return Number(quantityMatch[2]) < Number(quantityMatch[1]) ? 'quantity_decrease' : 'quantity_increase';
  if (/decrease|reduce|less/i.test(request)) return 'quantity_decrease';
  return 'quantity_increase';
}

function calculation(request, orderData) {
  const item = orderData?.lineItems?.[0];
  const match = request.match(/(?:from\s*)?(\d+)\s*(?:to|→)\s*(\d+)/i);
  const currentQty = match ? Number(match[1]) : item?.quantity || 0;
  const proposedQty = match ? Number(match[2]) : currentQty;
  const unitPrice = Number(item?.unitPrice || 0);
  const difference = (proposedQty - currentQty) * unitPrice;
  return { currentQty, proposedQty, unitPrice, difference, proposedTotal: Number(orderData?.total || 0) + difference };
}

async function saveChangeRequest(order, request, orderData) {
  const type = requestType(request);
  const money = calculation(request, orderData);
  const statusForPayment = type === 'quantity_increase' && money.difference > 0 ? 'payment_due' : 'needs_review';
  const body = {
    source: 'manual', shop_domain: 'kai-order-change-demo.myshopify.com', shopify_order_id: orderData?.id || null,
    order_number: orderData?.name || order, customer_name: [orderData?.customer?.firstName, orderData?.customer?.lastName].filter(Boolean).join(' ') || null,
    customer_phone: orderData?.customer?.phone || null, request_type: type, customer_message: request,
    order_date: orderData?.createdAt || null, current_order: orderData || {},
    proposed_change: { type, ...money }, current_total: Number(orderData?.total || 0), proposed_total: money.proposedTotal,
    amount_difference: money.difference, payment_status: orderData?.financialStatus || null,
    fulfillment_status: orderData?.fulfillmentStatus || null, status: statusForPayment
  };
  const response = await fetch('/api/change-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not save request');
  activeRequestId = data.request.id;
  return data.request;
}

function renderRecommendation({ order, request, orderData }) {
  const isAddressChange = /address|delivery/i.test(request);
  const isQuantityChange = /quantity|qty|two|increase|decrease/i.test(request);
  const isCancellation = /cancel|remove|refund/i.test(request);
  const productName = orderData?.lineItems?.[0]?.title;
  const orderLabel = orderData?.name || order;
  if (orderData?.sku) document.querySelector('#sku').value = orderData.sku;
  document.querySelector('#actionTitle').textContent = isAddressChange ? 'Verify address, then update before dispatch' : isQuantityChange ? 'Check stock and payment difference before quantity update' : isCancellation ? 'Confirm item and refund impact before removal' : 'Review and prepare the requested order update';
  document.querySelector('#actionCopy').textContent = `${orderLabel}${productName ? ` (${productName})` : ''} needs a controlled update. No store change will be sent until your team confirms the final action.`;
  const money = calculation(request, orderData);
  if (isQuantityChange && money.unitPrice) document.querySelector('#actionCopy').textContent += ` Quantity ${money.currentQty} → ${money.proposedQty}: ${money.difference > 0 ? 'payment due' : 'refund due'} ${Math.abs(money.difference).toFixed(2)} ${orderData.currency || ''}.`;
  document.querySelector('#checkList').innerHTML = [
    orderData ? `Live Shopify check: ${orderData.fulfillmentStatus || 'unfulfilled'}` : 'Order status reviewed: not dispatched',
    isQuantityChange ? 'Requested quantity change flagged for stock and payment check' : isCancellation ? 'Item removal and refund impact flagged for review' : 'Requested change captured for review',
    isAddressChange ? 'Delivery address needs customer confirmation' : 'Customer message is ready for confirmation',
    orderData?.financialStatus ? `Payment status: ${orderData.financialStatus}` : null
  ].filter(Boolean).map(item => `<li>${item}</li>`).join('');
  document.querySelector('#customerReply').textContent = `Hi${orderData?.customer?.firstName ? ` ${orderData.customer.firstName}` : ''}, we received your request for order ${orderLabel}. Our team is checking the change now and will confirm the updated order details shortly.`;
  document.querySelector('#confidence').textContent = isAddressChange ? 'High' : 'Medium';
  status.textContent = orderData ? 'Live order loaded' : 'Analysis ready';
  status.style.color = '#19d6d1';
  emptyState.classList.add('hidden'); resultGrid.classList.remove('hidden');
  steps.forEach((step, index) => step.classList.toggle('active', index < 3));
  document.querySelector('#results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const order = document.querySelector('#orderId').value.trim() || 'this order';
  const request = document.querySelector('#requestText').value.trim();
  const isShopify = document.querySelector('#platformSelect').value === 'Shopify';
  if (isShopify && shopifyConnected) {
    status.textContent = 'Loading Shopify order…';
    try {
      const response = await fetch(`/api/order-lookup?order=${encodeURIComponent(order)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Order could not be loaded');
      const saved = await saveChangeRequest(order, request, data.order);
      renderRecommendation({ order, request, orderData: data.order });
      status.textContent = saved.status === 'payment_due' ? 'Saved · payment due' : 'Saved for team review';
      loadSavedRequests();
      return;
    } catch (error) {
      formNote.textContent = `${error.message}. Demo analysis shown instead.`;
    }
  }
  try {
    const saved = await saveChangeRequest(order, request);
    renderRecommendation({ order, request });
    activeRequestId = saved.id;
    loadSavedRequests();
  } catch (error) {
    formNote.textContent = error.message;
    renderRecommendation({ order, request });
  }
});

document.querySelector('#approveButton').addEventListener('click', async (event) => {
  if (activeRequestId) await fetch('/api/change-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: activeRequestId, action: 'approved' }) });
  event.currentTarget.innerHTML = 'Ready for team approval <span>✓</span>';
  event.currentTarget.style.background = '#73dfae';
  steps.forEach(step => step.classList.add('active'));
});

async function loadSavedRequests() {
  try {
    const response = await fetch('/api/change-requests');
    const data = await response.json();
    if (!response.ok || !data.requests?.length) return;
    requestQueue.innerHTML = data.requests.map(row => `<button class="queue-item" data-order="${row.order_number}" data-request="${row.customer_message}" data-source="${row.source}"><span class="source ${row.source === 'whatsapp' ? 'whatsapp-dot' : 'email-dot'}">${row.source === 'whatsapp' ? '⌁' : '✎'}</span><span class="queue-main"><b>${row.customer_name || 'Customer'} · ${row.order_number}</b><small>${row.customer_message}</small></span><span class="change-tag ${row.request_type.includes('quantity') ? 'quantity' : row.request_type.includes('address') ? 'address' : 'cancel'}">${row.request_type.replaceAll('_', ' ')}</span><span class="queue-state ${row.status === 'payment_due' ? 'calculate' : 'review'}">${row.status.replaceAll('_', ' ')}</span></button>`).join('');
  } catch (_) { /* The desk still works while the database is unavailable. */ }
}

loadSavedRequests();

document.querySelector('#copyButton').addEventListener('click', async (event) => {
  await navigator.clipboard.writeText(document.querySelector('#customerReply').textContent);
  event.currentTarget.textContent = 'Copied';
  setTimeout(() => event.currentTarget.textContent = 'Copy reply', 1600);
});

document.querySelector('#helpButton').addEventListener('click', () => helpDialog.showModal());
helpDialog.querySelector('.close-dialog').addEventListener('click', () => helpDialog.close());
