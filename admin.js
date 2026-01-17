function getDebugToken(){
  try { return localStorage.getItem('tmr_debug_token') || ''; } catch (_) { return ''; }
}

function setDebugToken(token){
  try { localStorage.setItem('tmr_debug_token', token || ''); } catch (_) {}
}

function withDebugHeader(path, opts){
  const needsToken = typeof path === 'string' && (path.startsWith('/debug/') || path.startsWith('/admin/'));
  if (!needsToken) return opts || {};
  const token = getDebugToken();
  const headers = { ...(opts && opts.headers ? opts.headers : {}) };
  if (token) headers['x-tmr-debug-token'] = token;
  return { ...(opts || {}), headers };
}

async function api(path, opts={}){
  const finalOpts = withDebugHeader(path, opts);
  const res = await fetch(path, finalOpts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  try { return await res.json(); } catch(e){ return await res.text(); }
}

function short(e){ return e.length>80? e.slice(0,80)+'…': e }

function endpointHost(endpoint){
  try { return new URL(endpoint).host; } catch (_) { return ''; }
}

async function copyText(text){
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

async function load(){
  const list = document.getElementById('list');
  list.textContent = 'Loading…';
  try{
    const data = await api('/debug/subscriptions');
    const subs = data.subscriptions || [];
    if (!subs.length) { list.innerHTML = '<div class="small">No subscriptions</div>'; return }

    const table = document.createElement('table'); table.className='table';
    const thead = document.createElement('thead'); thead.innerHTML = '<tr><th>Id</th><th>User</th><th>Push Host</th><th>Endpoint</th><th>Created</th><th>Action</th></tr>'
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    subs.forEach(s => {
      const tr = document.createElement('tr');
      const created = new Date(s.createdAt).toLocaleString();
      const userLabel = (s.userId == null || String(s.userId).trim() === '') ? '(unbound)' : String(s.userId);
      const fullEndpoint = (s.subscription && s.subscription.endpoint) ? String(s.subscription.endpoint) : '';
      const host = endpointHost(fullEndpoint);

      tr.innerHTML = `<td>${s.id}</td><td class="small">${userLabel}</td><td class="small">${host}</td><td class="small" title="${fullEndpoint.replace(/"/g, '&quot;')}">${short(fullEndpoint)}</td><td class="small">${created}</td><td></td>`;
      const actionTd = tr.querySelector('td:last-child');

      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy Endpoint';
      copyBtn.className = 'action-btn';
      copyBtn.onclick = async () => {
        const ok = await copyText(fullEndpoint);
        const status = document.getElementById('status');
        if (status) status.textContent = ok ? `Copied endpoint for id=${s.id}` : 'Copy failed (clipboard blocked)';
        setTimeout(()=> { if (status) status.textContent=''; }, 2500);
      };

      const sendBtn = document.createElement('button'); sendBtn.textContent='Send'; sendBtn.className='action-btn';
      sendBtn.onclick = ()=> sendTo(s.id);
      actionTd.appendChild(copyBtn);
      actionTd.appendChild(sendBtn);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    list.innerHTML = '';
    list.appendChild(table);
  }catch(err){
    list.innerHTML = `<div class="small">Error loading subscriptions: ${err.message}</div>`
  }
}

async function loadReceipts(){
  const el = document.getElementById('receipts');
  if (!el) return;
  el.textContent = 'Loading…';
  try{
    const data = await api('/debug/push-receipts');
    const receipts = data.receipts || [];
    if (!receipts.length) { el.textContent = 'No recent receipts'; return; }

    const table = document.createElement('table');
    table.className = 'table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Receipt</th><th>Sub Id</th><th>Created</th><th>Seen</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const r of receipts.slice(0, 50)) {
      const tr = document.createElement('tr');
      const created = r.createdAt ? new Date(r.createdAt).toLocaleTimeString() : '';
      const seen = r.seenAt ? new Date(r.seenAt).toLocaleTimeString() : '(not seen)';
      tr.innerHTML = `<td class="small">${String(r.receiptId || '')}</td><td>${String(r.subscriptionId || '')}</td><td class="small">${created}</td><td class="small">${seen}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    el.innerHTML = '';
    el.appendChild(table);
  }catch(err){
    el.textContent = `Error loading receipts: ${err.message}`;
  }
}

async function sendTo(id){
  const status = document.getElementById('status');
  status.textContent = 'Sending…';
  let payload;
  try{ payload = JSON.parse(document.getElementById('payload').value) }catch(e){ status.textContent='Invalid JSON payload'; return }
  try{
    const res = await api(`/admin/send/${id}`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    const receipt = res && res.receiptId ? ` receiptId=${res.receiptId}` : '';
    const pushStatus = res && res.pushStatus ? ` pushStatus=${res.pushStatus}` : '';
    const diag = res && res.diag ? ` diag=${JSON.stringify(res.diag)}` : '';
    status.textContent = `Sent to id=${id}${pushStatus}${receipt}`;

    if (diag) {
      // Keep it readable; show diag in console as well.
      console.log('[admin/send] diag', res.diag, res.headers);
      status.textContent = `Sent to id=${id}${pushStatus}${receipt}${diag}`;
    }

    // Give the push a moment to arrive, then refresh receipts.
    setTimeout(loadReceipts, 800);
  }catch(err){ status.textContent = `Error sending to ${id}: ${err.message}` }
  setTimeout(()=> status.textContent='',4000);
}

async function sendAll(){
  const status = document.getElementById('status');
  status.textContent = 'Sending to all…';
  try{
    const data = await api('/debug/subscriptions');
    const ids = (data.subscriptions||[]).map(s=>s.id);
    for (const id of ids){
      try{ await api(`/admin/send/${id}`, {method:'POST', headers:{'Content-Type':'application/json'}, body: document.getElementById('payload').value}) }
      catch(e){ console.warn('send failed',id,e) }
    }
    status.textContent = `Sent attempts to ${ids.length} subscriptions`;
  }catch(err){ status.textContent = `Error: ${err.message}` }
  setTimeout(()=> status.textContent='',4000);
}

async function runCleanup(){
  const status = document.getElementById('status');
  status.textContent = 'Running cleanup…';
  try{
    const res = await api('/admin/cleanup', {method:'POST'});
    status.textContent = `Cleanup complete: ${res.results.length} probed`;
    await load();
  }catch(err){ status.textContent = `Cleanup error: ${err.message}` }
  setTimeout(()=> status.textContent='',4000);
}

document.addEventListener('DOMContentLoaded', ()=>{
  const tokenInput = document.getElementById('debugToken');
  const saveBtn = document.getElementById('saveToken');
  if (tokenInput) tokenInput.value = getDebugToken();
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const v = tokenInput ? String(tokenInput.value || '').trim() : '';
      setDebugToken(v);
      const status = document.getElementById('status');
      if (status) status.textContent = v ? 'Token saved' : 'Token cleared';
      setTimeout(() => { if (status) status.textContent = ''; }, 2500);
      load();
    });
  }

  document.getElementById('sendAll').addEventListener('click', sendAll);
  document.getElementById('cleanup').addEventListener('click', runCleanup);
  const loadReceiptsBtn = document.getElementById('loadReceipts');
  if (loadReceiptsBtn) loadReceiptsBtn.addEventListener('click', loadReceipts);
  load();
  loadReceipts();
});
