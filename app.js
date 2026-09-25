const $ = (s) => document.querySelector(s);
let requests = [], activeOrder = null, activeRequest = null;
const params = new URLSearchParams(location.search);
let shopifyConnected = params.get('connected') === 'shopify';
const money = (n, c = 'PKR') => new Intl.NumberFormat('en-PK', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(Number(n || 0));
const orderNo = (n) => String(n || '').startsWith('#') ? String(n) : `#${String(n || '').replace('#', '')}`;

function typeOf(message) {
  if (/address|delivery/i.test(message)) return 'address_change';
  if (/cancel|nahi chahiye|nahin chahiye|order nahi/i.test(message)) return 'cancel_order';
  if (/remove|refund/i.test(message)) return 'remove_item';
  const p = message.match(/(?:from\s*)?(\d+)\s*(?:to|→)\s*(\d+)/i);
  return p && +p[2] < +p[1] ? 'quantity_decrease' : 'quantity_increase';
}
function quantities(message, fallback) {
  const p = message.match(/(?:from\s*)?(\d+)\s*(?:to|→)\s*(\d+)/i);
  const latest = message.match(/(?:to|quantity|qty|items?|pieces?|pcs|chahiye|chaheye|chahie)\s*(?:is|=|:)?\s*(\d+)/i) || message.match(/(\d+)\s*(?:items?|pieces?|pcs|chahiye|chaheye|chahie)/i);
  return p ? { from: +p[1], to: +p[2] } : latest ? { from: fallback, to: +latest[1] } : { from: fallback, to: fallback };
}
function groups() { return Object.values(requests.reduce((a, r) => { const k = orderNo(r.order_number); (a[k] ||= []).push(r); return a; }, {})); }
function latest(rows) { return [...rows].sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0]; }
function original(row) { const o = row.current_order || {}, item = o.lineItems?.[0] || {}; return { qty: +(item.quantity || 0), total: +(row.current_total ?? o.total ?? 0), unit: +(item.unitPrice || 0), currency: o.currency || 'PKR' }; }
function final(rows) { const initial = original(rows[0]); let qty = initial.qty, total = initial.total; [...rows].sort((a,b) => new Date(a.created_at)-new Date(b.created_at)).forEach(r => { const p = r.proposed_change || {}; if (Number.isFinite(+p.proposedQty)) qty = +p.proposedQty; if (Number.isFinite(+r.proposed_total)) total = +r.proposed_total; }); return { ...initial, qty, total, diff: total - initial.total }; }
function label(row) { return row.status === 'approved' ? 'Finalised' : row.status === 'rejected' ? 'Rejected' : row.status === 'payment_due' ? 'Payment due' : 'Dispatch hold'; }

async function json(url, opts) { const res = await fetch(url, opts); const text = await res.text(); let data; try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('Server response is invalid. Check the latest Vercel function log.'); } if (!res.ok) throw new Error(data.error || 'Request failed.'); return data; }
function shopifyState() { if (shopifyConnected) { $('#shopifyConnect').classList.add('connected'); $('#shopifyConnect em').textContent = 'Connected'; $('#formNote').textContent = 'Shopify connected. The original order is read before every request is saved.'; history.replaceState({}, document.title, location.pathname); } }

function renderSummary() {
  let hold=0, pay=0, refund=0, approved=0;
  groups().forEach(g => { const r=latest(g), f=final(g); r.status === 'approved' ? approved++ : hold++; if (r.status === 'payment_due') pay += Math.max(f.diff,0); if (f.diff < 0 && r.status !== 'rejected') refund += -f.diff; });
  $('#pendingCount').textContent=hold; $('#paymentDue').textContent=money(pay); $('#refundDue').textContent=money(refund); $('#approvedCount').textContent=approved; $('#connectionStatus').textContent='Database connected';
}
function renderQueue() {
  const list=groups().sort((a,b)=>new Date(latest(b).created_at)-new Date(latest(a).created_at));
  $('#requestQueue').innerHTML=list.length ? list.map(g => { const r=latest(g), f=final(g), is=orderNo(r.order_number)===activeOrder, kind=f.diff>0?'quantity':f.diff<0?'cancel':'address'; return `<button class="queue-item ${is?'selected':''}" data-order="${orderNo(r.order_number)}"><span class="source ${r.source==='whatsapp'?'whatsapp-dot':'email-dot'}">${r.source==='whatsapp'?'⌁':'✎'}</span><span class="queue-main"><b>${r.customer_name||'Customer'} · ${orderNo(r.order_number)}</b><small>${g.length} request${g.length===1?'':'s'} · final qty ${f.qty} · ${money(f.total,f.currency)}</small></span><span class="change-tag ${kind}">${f.diff>0?'Increase':f.diff<0?'Decrease':String(r.request_type).replaceAll('_',' ')}</span><span class="queue-state ${r.status==='approved'?'final':r.status==='payment_due'?'calculate':'review'}">${label(r)}</span></button>`; }).join('') : '<div class="empty-queue">No saved requests yet. Start with Shopify order #1002.</div>';
}
function renderOrder(number) {
  const rows=groups().find(g=>orderNo(g[0].order_number)===number); if(!rows) return;
  const r=latest(rows), o=original(rows[0]), f=final(rows), shop=r.current_order||{}, isWhatsApp=r.source==='whatsapp'; activeOrder=number; activeRequest=r.id;
  $('#emptyOrder').classList.add('hidden'); $('#orderTruth').classList.remove('hidden'); $('#selectedOrder').textContent=number; $('#selectedCustomer').textContent=`${r.customer_name||'Customer'}${isWhatsApp&&r.customer_phone?` · ${r.customer_phone}`:''}`; $('#selectedDate').textContent=shop.createdAt?new Date(shop.createdAt).toLocaleDateString():isWhatsApp?'WhatsApp order':'Original order'; $('#originalOrderLabel').textContent=isWhatsApp?'Original WhatsApp order':'Original Shopify order'; $('#originalQty').textContent=`${o.qty} item${o.qty===1?'':'s'}`; $('#originalTotal').textContent=money(o.total,o.currency); $('#finalQty').textContent=`${f.qty} item${f.qty===1?'':'s'}`; $('#finalTotal').textContent=money(f.total,o.currency);
  $('#moneyLabel').textContent=f.diff>0?'Additional payment required before approval':f.diff<0?'Refund / credit required after approval':'No payment difference'; $('#moneyDifference').textContent=f.diff?`${f.diff>0?'+':'−'} ${money(Math.abs(f.diff),o.currency)}`:'No change'; $('#dispatchFlag').textContent=label(r); $('#dispatchInstruction').textContent=r.status==='approved'?`FINAL DISPATCH STATE: fulfil ${f.qty} item${f.qty===1?'':'s'} only.`:r.status==='payment_due'?'DISPATCH HOLD: collect additional payment, then approve the final state.':'DISPATCH HOLD: do not fulfil the original order until the latest request is approved or rejected.';
  $('#actionTitle').textContent=r.status==='approved'?`Final quantity is ${f.qty}. Ready for fulfilment.`:f.diff>0?'Collect the difference, then approve the latest quantity.':f.diff<0?'Confirm refund or credit, then approve the reduced quantity.':'Verify the request, then approve or reject it.'; $('#actionCopy').textContent=`Original order: ${o.qty} item(s), ${money(o.total,o.currency)}. Latest controlled state: ${f.qty} item(s), ${money(f.total,o.currency)}. ${rows.length>1?'Earlier requests remain in the timeline and do not control dispatch.':''}`;
  $('#historyList').innerHTML=[...rows].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).map((x,i)=>{const p=x.proposed_change||{};return `<li><b>${i+1}. ${String(x.request_type).replaceAll('_',' ')}</b><small>${x.customer_message}</small><em>${p.currentQty??'—'} → ${p.proposedQty??'—'} · ${label(x)}</em></li>`}).join(''); $('#customerReply').textContent=r.status==='approved'?`Hi ${r.customer_name||''}, your order ${number} has been updated to the final confirmed details. Thank you.`:`Hi ${r.customer_name||''}, we received your change request for order ${number}. We are checking the final quantity and payment details before dispatch, and will confirm shortly.`;
  $('#emptyState').classList.add('hidden'); $('#resultGrid').classList.remove('hidden'); document.querySelectorAll('.step').forEach((s,i)=>s.classList.toggle('active',i<(r.status==='approved'?4:3))); renderQueue();
}
async function load() { try { const d=await json('/api/change-requests'); requests=d.requests||[]; renderSummary(); renderQueue(); if(activeOrder) renderOrder(activeOrder); } catch(e) { $('#connectionStatus').textContent='Database needs attention'; $('#formNote').textContent=e.message; } }

$('#shopifyConnect').addEventListener('click',()=>{if(shopifyConnected)return;const shop=prompt('Enter your Shopify store domain','kai-order-change-demo.myshopify.com');if(shop)location.href=`/api/auth?shop=${encodeURIComponent(shop.trim())}`});
function sourceUI() {
  const whatsapp=$('#sourceSelect').value==='whatsapp';
  $('#whatsappFields').classList.toggle('hidden',!whatsapp);
  $('#shopifyConnect').classList.toggle('hidden',whatsapp);
  $('#orderLabel').firstChild.textContent=whatsapp?'WhatsApp order reference':'Order number';
  $('#orderId').placeholder=whatsapp?'WA-1001':'#1002';
  $('#formNote').textContent=whatsapp?'Enter the same WhatsApp reference for every later message. The app keeps one full order history and uses only the latest state for dispatch.':'Connect Shopify first. The app reads the order but does not update Shopify from this screen.';
}
$('#sourceSelect').addEventListener('change',sourceUI);
$('#newRequestButton').addEventListener('click',()=>{$('#requestForm').reset();sourceUI();$('#orderId').focus();$('#requestStatus').textContent='New request'});
$('#requestQueue').addEventListener('click',e=>{const item=e.target.closest('.queue-item');if(item){renderOrder(item.dataset.order);$('#activeOrderPanel').scrollIntoView({behavior:'smooth',block:'center'})}});
$('#requestForm').addEventListener('submit',async e=>{e.preventDefault();
  const source=$('#sourceSelect').value, number=orderNo($('#orderId').value.trim()), message=$('#requestText').value.trim(), isWhatsApp=source==='whatsapp';
  if(!number || !message) return;
  try {
    let order, prior, base, before;
    if(isWhatsApp) {
      const name=$('#waCustomerName').value.trim(), phone=$('#waCustomerPhone').value.replace(/\D/g,''), product=$('#waProduct').value.trim(), enteredQty=+$('#waOriginalQty').value, enteredUnit=+$('#waUnitPrice').value;
      if(!name || !phone || !product || !(enteredQty>0) || !(enteredUnit>=0)) throw new Error('For a WhatsApp order enter customer name, WhatsApp number, product, original quantity and unit price.');
      prior=groups().find(g=>orderNo(g[0].order_number)===number)||[];
      base=prior.length?original(prior[0]):{qty:enteredQty,total:enteredQty*enteredUnit,unit:enteredUnit,currency:'PKR'};
      before=prior.length?final(prior):base;
      order={id:null,name:number,createdAt:prior[0]?.order_date||new Date().toISOString(),total:base.total,currency:'PKR',financialStatus:'COD / manual',fulfillmentStatus:'UNFULFILLED',customer:{firstName:name,lastName:'',phone},lineItems:[{title:product,quantity:base.qty,unitPrice:base.unit}]};
      $('#requestStatus').textContent='Calculating WhatsApp final state…';
    } else {
      if(!shopifyConnected) throw new Error('Connect Shopify first so this request is locked to the original live order.');
      $('#requestStatus').textContent='Reading original Shopify order…';
      const found=await json(`/api/order-lookup?order=${encodeURIComponent(number)}`); order=found.order;
      prior=groups().find(g=>orderNo(g[0].order_number)===orderNo(order.name))||[];
      base=prior.length?original(prior[0]):{qty:+(order.lineItems?.[0]?.quantity||0),total:+(order.total||0),unit:+(order.lineItems?.[0]?.unitPrice||0),currency:order.currency||'PKR'};
      before=prior.length?final(prior):base;
    }
    const parsedType=typeOf(message), q=quantities(message,before.qty), proposedQty=parsedType==='cancel_order'?0:parsedType.includes('quantity')?q.to:before.qty, type=parsedType==='quantity_increase'&&proposedQty<before.qty?'quantity_decrease':parsedType, proposedTotal=type==='cancel_order'?0:type.includes('quantity')?base.total+(proposedQty-base.qty)*base.unit:base.total, diff=proposedTotal-base.total;
    const payload={source,shop_domain:isWhatsApp?'whatsapp':'kai-order-change-demo.myshopify.com',shopify_order_id:order.id,order_number:order.name,customer_name:[order.customer?.firstName,order.customer?.lastName].filter(Boolean).join(' '),customer_phone:order.customer?.phone||null,request_type:type,customer_message:message,order_date:order.createdAt,current_order:order,proposed_change:{type,originalQty:base.qty,currentQty:before.qty,proposedQty,unitPrice:base.unit,priorRequestCount:prior.length},current_total:base.total,proposed_total:proposedTotal,amount_difference:diff,payment_status:order.financialStatus||null,fulfillment_status:order.fulfillmentStatus||null,status:diff>0?'payment_due':'needs_review'};
    $('#requestStatus').textContent='Saving controlled change…'; await json('/api/change-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); activeOrder=orderNo(order.name); await load(); renderOrder(activeOrder); $('#requestStatus').textContent=diff>0?'Saved · payment due':'Saved · dispatch hold'; $('#results').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(err) { $('#requestStatus').textContent='Could not save'; $('#formNote').textContent=err.message; }
});
async function act(action){if(!activeRequest)return;try{await json('/api/change-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:activeRequest,action})});await load();renderOrder(activeOrder)}catch(e){$('#formNote').textContent=e.message}}
$('#approveButton').addEventListener('click',()=>act('approved'));$('#rejectButton').addEventListener('click',()=>act('rejected'));$('#copyButton').addEventListener('click',async e=>{await navigator.clipboard.writeText($('#customerReply').textContent);e.currentTarget.textContent='Copied';setTimeout(()=>e.currentTarget.textContent='Copy reply',1500)});$('#helpButton').addEventListener('click',()=>$('#helpDialog').showModal());$('#helpDialog .close-dialog').addEventListener('click',()=>$('#helpDialog').close());
shopifyState();sourceUI();load();

