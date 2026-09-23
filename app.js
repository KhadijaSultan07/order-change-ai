const platforms = document.querySelectorAll('.platform-card');
const steps = document.querySelectorAll('.step');
const form = document.querySelector('#requestForm');
const resultGrid = document.querySelector('#resultGrid');
const emptyState = document.querySelector('#emptyState');
const status = document.querySelector('#requestStatus');
const helpDialog = document.querySelector('#helpDialog');
const formNote = document.querySelector('#formNote');

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

document.querySelector('#resetConnections').addEventListener('click', () => platforms.forEach((card) => {
  card.classList.remove('connected'); card.querySelector('em').textContent = 'Connect';
}));

function renderRecommendation({ order, request, orderData }) {
  const isAddressChange = /address|delivery/i.test(request);
  const isQuantityChange = /quantity|quantity|2|two/i.test(request);
  const productName = orderData?.lineItems?.[0]?.title;
  const orderLabel = orderData?.name || order;
  if (orderData?.sku) document.querySelector('#sku').value = orderData.sku;
  document.querySelector('#actionTitle').textContent = isAddressChange ? 'Verify address, then update before dispatch' : 'Review and prepare the requested order update';
  document.querySelector('#actionCopy').textContent = `${orderLabel}${productName ? ` (${productName})` : ''} needs a controlled update. No store change will be sent until your team confirms the final action.`;
  document.querySelector('#checkList').innerHTML = [
    orderData ? `Live Shopify check: ${orderData.fulfillmentStatus || 'unfulfilled'}` : 'Order status reviewed: not dispatched',
    isQuantityChange ? 'Requested quantity change flagged for stock check' : 'Requested change captured for review',
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
      renderRecommendation({ order, request, orderData: data.order });
      return;
    } catch (error) {
      formNote.textContent = `${error.message}. Demo analysis shown instead.`;
    }
  }
  renderRecommendation({ order, request });
});

document.querySelector('#approveButton').addEventListener('click', (event) => {
  event.currentTarget.innerHTML = 'Ready for team approval <span>✓</span>';
  event.currentTarget.style.background = '#73dfae';
  steps.forEach(step => step.classList.add('active'));
});

document.querySelector('#copyButton').addEventListener('click', async (event) => {
  await navigator.clipboard.writeText(document.querySelector('#customerReply').textContent);
  event.currentTarget.textContent = 'Copied';
  setTimeout(() => event.currentTarget.textContent = 'Copy reply', 1600);
});

document.querySelector('#helpButton').addEventListener('click', () => helpDialog.showModal());
helpDialog.querySelector('.close-dialog').addEventListener('click', () => helpDialog.close());
