const platforms = document.querySelectorAll('.platform-card');
const steps = document.querySelectorAll('.step');
const form = document.querySelector('#requestForm');
const resultGrid = document.querySelector('#resultGrid');
const emptyState = document.querySelector('#emptyState');
const status = document.querySelector('#requestStatus');
const helpDialog = document.querySelector('#helpDialog');

platforms.forEach((card) => card.addEventListener('click', () => {
  card.classList.toggle('connected');
  card.querySelector('em').textContent = card.classList.contains('connected') ? 'Connected' : 'Connect';
  document.querySelector('#platformSelect').value = card.dataset.platform === 'WhatsApp' ? 'Manual order' : card.dataset.platform;
}));

document.querySelector('#resetConnections').addEventListener('click', () => platforms.forEach((card) => {
  card.classList.remove('connected'); card.querySelector('em').textContent = 'Connect';
}));

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const order = document.querySelector('#orderId').value.trim() || 'this order';
  const request = document.querySelector('#requestText').value.trim();
  const isAddressChange = /address|delivery/i.test(request);
  const isQuantityChange = /quantity|quantity|2|two/i.test(request);
  document.querySelector('#actionTitle').textContent = isAddressChange ? 'Verify address, then update before dispatch' : 'Review and prepare the requested order update';
  document.querySelector('#actionCopy').textContent = `${order} needs a controlled update. No store change will be sent until your team confirms the final action.`;
  document.querySelector('#checkList').innerHTML = [
    'Order status reviewed: not dispatched',
    isQuantityChange ? 'Requested quantity change flagged for stock check' : 'Requested change captured for review',
    isAddressChange ? 'Delivery address needs customer confirmation' : 'Customer message is ready for confirmation'
  ].map(item => `<li>${item}</li>`).join('');
  document.querySelector('#customerReply').textContent = `Hi, we received your request for order ${order}. Our team is checking the change now and will confirm the updated order details shortly.`;
  document.querySelector('#confidence').textContent = isAddressChange ? 'High' : 'Medium';
  status.textContent = 'Analysis ready';
  status.style.color = '#19d6d1';
  emptyState.classList.add('hidden'); resultGrid.classList.remove('hidden');
  steps.forEach((step, index) => step.classList.toggle('active', index < 3));
  document.querySelector('#results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
