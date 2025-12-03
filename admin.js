async function api(path, opts={}){
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  try { return await res.json(); } catch(e){ return await res.text(); }
}

function short(e){ return e.length>80? e.slice(0,80)+'…': e }

async function load(){
  const list = document.getElementById('list');
  list.textContent = 'Loading…';
  try{
    const data = await api('/debug/subscriptions');
    const subs = data.subscriptions || [];
    if (!subs.length) { list.innerHTML = '<div class="small">No subscriptions</div>'; return }

    const table = document.createElement('table'); table.className='table';
    const thead = document.createElement('thead'); thead.innerHTML = '<tr><th>Id</th><th>Endpoint</th><th>Created</th><th>Action</th></tr>'
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    subs.forEach(s => {
      const tr = document.createElement('tr');
      const created = new Date(s.createdAt).toLocaleString();
      tr.innerHTML = `<td>${s.id}</td><td class="small">${short(s.subscription.endpoint)}</td><td class="small">${created}</td><td></td>`;
      const actionTd = tr.querySelector('td:last-child');
      const sendBtn = document.createElement('button'); sendBtn.textContent='Send'; sendBtn.className='action-btn';
      sendBtn.onclick = ()=> sendTo(s.id);
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

async function sendTo(id){
  const status = document.getElementById('status');
  status.textContent = 'Sending…';
  let payload;
  try{ payload = JSON.parse(document.getElementById('payload').value) }catch(e){ status.textContent='Invalid JSON payload'; return }
  try{
    const res = await api(`/admin/send/${id}`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    status.textContent = `Sent to id=${id}`;
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
  document.getElementById('sendAll').addEventListener('click', sendAll);
  document.getElementById('cleanup').addEventListener('click', runCleanup);
  load();
});
