const $ = (s) => document.querySelector(s);

let requests = [];
let activeOrder = null;
let activeRequest = null;

const params = new URLSearchParams(location.search);
let shopifyConnected = params.get('connected') === 'shopify';

const money = (n, c = 'PKR') =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: c,
    maximumFractionDigits: 2
  }).format(Number(n || 0));

const orderNo = (n) =>
  String(n || '').startsWith('#')
    ? String(n)
    : `#${String(n || '').replace('#', '')}`;

function typeOf(message) {
  if (/address|delivery/i.test(message)) return 'address_change';
  if (/cancel|nahi chahiye|nahin chahiye|order nahi/i.test(message)) return 'cancel_order';
  if (/remove|refund/i.test(message)) return 'remove_item';

  const p = message.match(/(?:from\s*)?(\d+)\s*(?:to|→)\s*(\d+)/i);
  return p && +p[2] < +p[1] ? 'quantity_decrease' : 'quantity_increase';
}

function quantities(message, fallback) {
  const p = message.match(/(?:from\s*)?(\d+)\s*(?:to|→)\s*(\d+)/i);

  const latest =
    message.match(/(?:to|quantity|qty|items?|pieces?|pcs|chahiye|chaheye|chahie|need(?:s)?)\s*(?:is|=|:)?\s*(\d+)/i) ||
    message.match(/(?:only|bas|sirf)\s*(\d+)/i) ||
    message.match(/(\d+)\s*(?:items?|pieces?|pcs|chahiye|chaheye|chahie|need(?:s)?)/i);

  return p
    ? { from: +p[1], to: +p[2] }
    : latest
      ? { from: fallback, to: +latest[1] }
      : { from: fallback, to: fallback };
}

function groups() {
  return Object.values(
    requests.reduce((all, row) => {
      const key = orderNo(row.order_number);
      (all[key] ||= []).push(row);
      return all;
    }, {})
  );
}

function latest(rows) {
  return [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}

function original(row) {
  const order = row.current_order || {};
  const item = order.lineItems?.[0] || {};

  return {
    qty: +(item.quantity || 0),
    total: +(row.current_total ?? order.total ?? 0),
    unit: +(item.unitPrice || 0),
    currency: order.currency || 'PKR'
  };
}

function final(rows) {
  const initial = original(rows[0]);
  let qty = initial.qty;
  let total = initial.total;

  [...rows]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .forEach((row) => {
      const change = row.proposed_change || {};

      if (Number.isFinite(+change.proposedQty)) {
        qty = +change.proposedQty;
      }

      if (Number.isFinite(+row.proposed_total)) {
        total = +row.proposed_total;
      }
    });

  return {
    ...initial,
    qty,
    total,
    diff: total - initial.total
  };
}

function label(row) {
  return row.status === 'approved'
    ? 'Finalised / فائنل'
    : row.status === 'rejected'
      ? 'Rejected / مسترد'
      : row.status === 'payment_due'
        ? 'Payment due / پیسے لینے ہیں'
        : 'Dispatch hold / ڈسپیچ روکیں';
}

async function json(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Server response is invalid. Check the latest Vercel function log.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

function shopifyState() {
  if (!shopifyConnected) return;

  $('#shopifyConnect').classList.add('connected');
  $('#shopifyConnect em').textContent = 'Connected';
  $('#formNote').textContent = 'Shopify connected. The original order is read before every request is saved.';

  history.replaceState({}, document.title, location.pathname);
}

function renderSummary() {
  let hold = 0;
  let pay = 0;
  let refund = 0;
  let approved = 0;

  groups().forEach((group) => {
    const row = latest(group);
    const state = final(group);

    if (row.status === 'approved') {
      approved++;
    } else {
      hold++;
    }

    if (row.status === 'payment_due') {
      pay += Math.max(state.diff, 0);
    }

    if (state.diff < 0 && row.status !== 'rejected') {
      refund += -state.diff;
    }
  });

  $('#pendingCount').textContent = hold;
  $('#paymentDue').textContent = money(pay);
  $('#refundDue').textContent = money(refund);
  $('#approvedCount').textContent = approved;
  $('#connectionStatus').textContent = 'Database connected';
}

function renderQueue() {
  const list = groups().sort(
    (a, b) => new Date(latest(b).created_at) - new Date(latest(a).created_at)
  );

  $('#requestQueue').innerHTML = list.length
    ? list.map((group) => {
        const row = latest(group);
        const old = original(group[0]);
        const state = final(group);

        const selected = orderNo(row.order_number) === activeOrder;
        const isFinal = row.status === 'approved';
        const payment = state.diff > 0;
        const refund = state.diff < 0;

        const action = isFinal
          ? 'بھیج دیں / Ready to send'
          : payment
            ? 'پہلے پیسے لیں / Collect payment'
            : refund
              ? 'ریفنڈ یا کریڈٹ چیک کریں / Check refund'
              : row.request_type === 'cancel_order'
                ? 'آرڈر منسوخی چیک کریں / Check cancellation'
                : 'ابھی ڈسپیچ نہ کریں / Keep on hold';

        const icon = row.source === 'whatsapp' ? '💬' : '🛍️';

        const moneyText = payment
          ? `+ ${money(state.diff, state.currency)} لینے ہیں / Collect`
          : refund
            ? `${money(Math.abs(state.diff), state.currency)} واپس دینے ہیں / Refund`
            : 'کوئی اضافی ادائیگی نہیں / No extra payment';

        return `
          <button class="order-card ${selected ? 'selected' : ''} ${isFinal ? 'safe' : 'hold'}" data-order="${orderNo(row.order_number)}">
            <div class="order-card-top">
              <span class="source ${row.source === 'whatsapp' ? 'whatsapp-dot' : 'email-dot'}">${icon}</span>

              <span>
                <b>${row.customer_name || 'Customer'} · ${orderNo(row.order_number)}</b>
                <small>${row.source === 'whatsapp' ? 'WhatsApp customer' : 'Shopify customer'} · ${group.length} request${group.length === 1 ? '' : 's'}</small>
              </span>

              <span class="simple-status ${isFinal ? 'safe' : 'stop'}">
                ${isFinal ? '✓ FINAL' : '⏸ HOLD'}
              </span>
            </div>

            <div class="quantity-compare">
              <div>
                <small>پہلے / Original</small>
                <b>${old.qty}</b>
                <span>item${old.qty === 1 ? '' : 's'}</span>
              </div>

              <strong>→</strong>

              <div class="latest">
                <small>اب فائنل / Final now</small>
                <b>${state.qty}</b>
                <span>item${state.qty === 1 ? '' : 's'}</span>
              </div>

              <div class="money-decision ${payment ? 'collect' : refund ? 'refund' : 'same'}">
                <small>پیسوں کا حساب / PAYMENT</small>
                <b>${moneyText}</b>
              </div>
            </div>

            <div class="action-line">
              <span>${action}</span>
              <em>تفصیل دیکھیں / View details →</em>
            </div>
          </button>
        `;
      }).join('')
    : '<div class="empty-queue">No saved requests yet. Start with Shopify order #1002.</div>';
}

function renderOrder(number) {
  const rows = groups().find((group) => orderNo(group[0].order_number) === number);
  if (!rows) return;

  const row = latest(rows);
  const old = original(rows[0]);
  const state = final(rows);
  const shop = row.current_order || {};
  const isWhatsApp = row.source === 'whatsapp';

  activeOrder = number;
  activeRequest = row.id;

  $('#emptyOrder').classList.add('hidden');
  $('#orderTruth').classList.remove('hidden');

  $('#selectedOrder').textContent = number;
  $('#selectedCustomer').textContent =
    `${row.customer_name || 'Customer'}${isWhatsApp && row.customer_phone ? ` · ${row.customer_phone}` : ''}`;

  $('#selectedDate').textContent = shop.createdAt
    ? new Date(shop.createdAt).toLocaleDateString()
    : isWhatsApp
      ? 'WhatsApp order'
      : 'Original order';

  $('#originalOrderLabel').textContent = isWhatsApp
    ? 'Original WhatsApp order'
    : 'Original Shopify order';

  $('#originalQty').textContent = `${old.qty} item${old.qty === 1 ? '' : 's'}`;
  $('#originalTotal').textContent = money(old.total, old.currency);

  $('#finalQty').textContent = `${state.qty} item${state.qty === 1 ? '' : 's'}`;
  $('#finalTotal').textContent = money(state.total, old.currency);

  $('#moneyLabel').textContent =
    state.diff > 0
      ? 'Additional payment required before approval'
      : state.diff < 0
        ? 'Refund / credit required after approval'
        : 'No payment difference';

  $('#moneyDifference').textContent = state.diff
    ? `${state.diff > 0 ? '+' : '−'} ${money(Math.abs(state.diff), old.currency)}`
    : 'No change';

  $('#dispatchFlag').textContent = label(row);

  $('#dispatchInstruction').textContent =
    row.status === 'approved'
      ? `FINAL DISPATCH STATE: fulfil ${state.qty} item${state.qty === 1 ? '' : 's'} only.`
      : row.status === 'payment_due'
        ? 'DISPATCH HOLD: collect additional payment, then approve the final state.'
        : 'DISPATCH HOLD: do not fulfil the original order until the latest request is approved or rejected.';

  $('#actionTitle').textContent =
    row.status === 'approved'
      ? `Final quantity is ${state.qty}. Ready for fulfilment.`
      : state.diff > 0
        ? 'Collect the difference, then approve the latest quantity.'
        : state.diff < 0
          ? 'Confirm refund or credit, then approve the reduced quantity.'
          : 'Verify the request, then approve or reject it.';

  $('#actionCopy').textContent =
    `Original order: ${old.qty} item(s), ${money(old.total, old.currency)}. ` +
    `Latest controlled state: ${state.qty} item(s), ${money(state.total, old.currency)}. ` +
    `${rows.length > 1 ? 'Earlier requests remain in the timeline and do not control dispatch.' : ''}`;

  $('#historyList').innerHTML = [...rows]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((item, index) => {
      const change = item.proposed_change || {};

      return `
        <li>
          <b>${index + 1}. ${String(item.request_type).replaceAll('_', ' ')}</b>
          <small>${item.customer_message}</small>
          <em>${change.currentQty ?? '—'} → ${change.proposedQty ?? '—'} · ${label(item)}</em>
        </li>
      `;
    }).join('');

  $('#customerReply').textContent =
    row.status === 'approved'
      ? `Hi ${row.customer_name || ''}, your order ${number} has been updated to the final confirmed details. Thank you.`
      : `Hi ${row.customer_name || ''}, we received your change request for order ${number}. We are checking the final quantity and payment details before dispatch, and will confirm shortly.`;

  $('#emptyState').classList.add('hidden');
  $('#resultGrid').classList.remove('hidden');

  document.querySelectorAll('.step').forEach((step, index) => {
    step.classList.toggle('active', index < (row.status === 'approved' ? 4 : 3));
  });

  renderQueue();
}

async function load() {
  try {
    const data = await json('/api/change-requests');
    requests = data.requests || [];

    renderSummary();
    renderQueue();

    if (activeOrder) {
      renderOrder(activeOrder);
    }
  } catch (error) {
    $('#connectionStatus').textContent = 'Database needs attention';
    $('#formNote').textContent = error.message;
  }
}

$('#shopifyConnect').addEventListener('click', () => {
  if (shopifyConnected) return;

  const shop = prompt(
    'Enter your Shopify store domain',
    'kai-order-change-demo.myshopify.com'
  );

  if (shop) {
    location.href = `/api/auth?shop=${encodeURIComponent(shop.trim())}`;
  }
});

function sourceUI() {
  const whatsapp = $('#sourceSelect').value === 'whatsapp';

  $('#whatsappFields').classList.toggle('hidden', !whatsapp);
  $('#shopifyConnect').classList.toggle('hidden', whatsapp);

  $('#orderLabel').firstChild.textContent = whatsapp
    ? 'WhatsApp order reference'
    : 'Order number';

  $('#orderId').placeholder = whatsapp ? 'WA-1001' : '#1002';

  $('#formNote').textContent = whatsapp
    ? 'Enter the same WhatsApp reference for every later message. The app keeps one full order history and uses only the latest state for dispatch.'
    : 'Connect Shopify first. The app reads the order but does not update Shopify from this screen.';
}

$('#sourceSelect').addEventListener('change', sourceUI);

$('#newRequestButton').addEventListener('click', () => {
  $('#requestForm').reset();
  sourceUI();
  $('#orderId').focus();
  $('#requestStatus').textContent = 'New request';
});

$('#requestQueue').addEventListener('click', (event) => {
  const item = event.target.closest('.order-card, .queue-item');

  if (item) {
    renderOrder(item.dataset.order);
    $('#activeOrderPanel').scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }
});

$('#requestForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const source = $('#sourceSelect').value;
  const number = orderNo($('#orderId').value.trim());
  const message = $('#requestText').value.trim();
  const isWhatsApp = source === 'whatsapp';

  if (!number || !message) return;

  try {
    let order;
    let prior;
    let base;
    let before;

    if (isWhatsApp) {
      const name = $('#waCustomerName').value.trim();
      const phone = $('#waCustomerPhone').value.replace(/\D/g, '');
      const product = $('#waProduct').value.trim();
      const enteredQty = +$('#waOriginalQty').value;
      const enteredUnit = +$('#waUnitPrice').value;

      if (!/^WA-/i.test(number)) {
        throw new Error('For WhatsApp use a separate order reference starting with WA-, for example WA-1002. Do not use a Shopify number such as #1003.');
      }

      if (!name || !phone || !product || !(enteredQty > 0) || !(enteredUnit > 0)) {
        throw new Error('For a WhatsApp order enter customer name, WhatsApp number, product, original quantity and unit price greater than zero.');
      }

      prior = groups().find((group) => orderNo(group[0].order_number) === number) || [];

      base = prior.length
        ? original(prior[0])
        : {
            qty: enteredQty,
            total: enteredQty * enteredUnit,
            unit: enteredUnit,
            currency: 'PKR'
          };

      before = prior.length ? final(prior) : base;

      order = {
        id: null,
        name: number,
        createdAt: prior[0]?.order_date || new Date().toISOString(),
        total: base.total,
        currency: 'PKR',
        financialStatus: 'COD / manual',
        fulfillmentStatus: 'UNFULFILLED',
        customer: {
          firstName: name,
          lastName: '',
          phone
        },
        lineItems: [
          {
            title: product,
            quantity: base.qty,
            unitPrice: base.unit
          }
        ]
      };

      $('#requestStatus').textContent = 'Calculating WhatsApp final state…';
    } else {
      if (!shopifyConnected) {
        throw new Error('Connect Shopify first so this request is locked to the original live order.');
      }

      $('#requestStatus').textContent = 'Reading original Shopify order…';

      const found = await json(
        `/api/order-lookup?order=${encodeURIComponent(number)}`
      );

      order = found.order;

      prior = groups().find(
        (group) => orderNo(group[0].order_number) === orderNo(order.name)
      ) || [];

      base = prior.length
        ? original(prior[0])
        : {
            qty: +(order.lineItems?.[0]?.quantity || 0),
            total: +(order.total || 0),
            unit: +(order.lineItems?.[0]?.unitPrice || 0),
            currency: order.currency || 'PKR'
          };

      before = prior.length ? final(prior) : base;
    }

    const parsedType = typeOf(message);
    const qty = quantities(message, before.qty);

    const proposedQty =
      parsedType === 'cancel_order'
        ? 0
        : parsedType.includes('quantity')
          ? qty.to
          : before.qty;

    const type =
      parsedType === 'quantity_increase' && proposedQty < before.qty
        ? 'quantity_decrease'
        : parsedType;

    const proposedTotal =
      type === 'cancel_order'
        ? 0
        : type.includes('quantity')
          ? base.total + (proposedQty - base.qty) * base.unit
          : base.total;

    const difference = proposedTotal - base.total;

    const payload = {
      source,
      shop_domain: isWhatsApp
        ? 'whatsapp'
        : 'kai-order-change-demo.myshopify.com',
      shopify_order_id: order.id,
      order_number: order.name,
      customer_name: [order.customer?.firstName, order.customer?.lastName]
        .filter(Boolean)
        .join(' '),
      customer_phone: order.customer?.phone || null,
      request_type: type,
      customer_message: message,
      order_date: order.createdAt,
      current_order: order,
      proposed_change: {
        type,
        originalQty: base.qty,
        currentQty: before.qty,
        proposedQty,
        unitPrice: base.unit,
        priorRequestCount: prior.length
      },
      current_total: base.total,
      proposed_total: proposedTotal,
      amount_difference: difference,
      payment_status: order.financialStatus || null,
      fulfillment_status: order.fulfillmentStatus || null,
      status: difference > 0 ? 'payment_due' : 'needs_review'
    };

    $('#requestStatus').textContent = 'Saving controlled change…';

    await json('/api/change-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    activeOrder = orderNo(order.name);

    await load();
    renderOrder(activeOrder);

    $('#requestStatus').textContent = difference > 0
      ? 'Saved · payment due'
      : 'Saved · dispatch hold';

    $('#results').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  } catch (error) {
    $('#requestStatus').textContent = 'Could not save';
    $('#formNote').textContent = error.message;
  }
});

async function act(action) {
  if (!activeRequest) return;

  try {
    await json('/api/change-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: activeRequest,
        action
      })
    });

    await load();
    renderOrder(activeOrder);
  } catch (error) {
    $('#formNote').textContent = error.message;
  }
}

$('#approveButton').addEventListener('click', () => act('approved'));
$('#rejectButton').addEventListener('click', () => act('rejected'));

$('#copyButton').addEventListener('click', async (event) => {
  await navigator.clipboard.writeText($('#customerReply').textContent);
  event.currentTarget.textContent = 'Copied';

  setTimeout(() => {
    event.currentTarget.textContent = 'Copy reply';
  }, 1500);
});

$('#helpButton').addEventListener('click', () => $('#helpDialog').showModal());
$('#helpDialog .close-dialog').addEventListener('click', () => $('#helpDialog').close());

shopifyState();
sourceUI();
load();
