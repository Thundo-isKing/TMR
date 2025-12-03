
const displayClock = () => {
    const now = new Date();
    let hrs = now.getHours();
    const ampm = hrs >= 12 ? 'PM' : 'AM';
    hrs = hrs % 12;
    hrs = hrs ? hrs : 12; // convert 0 to 12
    const min = String(now.getMinutes()).padStart(2, '0');
    const sec = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('clock').textContent = `${hrs}:${min}:${sec} ${ampm}`;
};

// Update clock immediately and then every second
displayClock();
setInterval(displayClock, 1000);

// Add refresh functionality (only if present)
const refreshBtn = document.querySelector('.refresh-button');
if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
        window.location.reload();
    });
}

// Add leave button functionality (only if present)
const leaveBtn = document.querySelector('.leave-button');
if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
        // Go back to TMR.html if not already there
        if (window.location.pathname.endsWith('CurrentSchedules.html')) {
            window.location.href = 'TMR.html';
        } else {
            window.location.href = 'https://www.google.com';
        }
    });
}

// Accent picker (global site accent)
(function(){
    const ACCENT_KEY = 'tmr_accent';
    function hexToRgb(hex){
        const h = hex.replace('#','');
        return h.length === 3 ? h.split('').map(c => parseInt(c+c,16)) : [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
    }
    function rgbToHex(r,g,b){
        return '#'+[r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
    }
    function darkenHex(hex,percent){
        const [r,g,b] = hexToRgb(hex).map(v => Math.max(0, Math.round(v*(1 - percent/100))));
        return rgbToHex(r,g,b);
    }
    function hexToRgbArr(hex) {
        const h = hex.replace('#','');
        if(h.length === 3) {
            return h.split('').map(c => parseInt(c+c,16));
        } else {
            return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
        }
    }
    function lightenHex(hex, percent) {
        const [r, g, b] = hexToRgb(hex).map(v => Math.min(255, Math.round(v + (255 - v) * (percent / 100))));
        return rgbToHex(r, g, b);
    }
    function applyAccent(hex){
        if(!hex) return;
        const root = document.documentElement;
        root.style.setProperty('--accent-color', hex);
        root.style.setProperty('--accent-hover', darkenHex(hex,18));
        root.style.setProperty('--accent-light', lightenHex(hex, 38));
        // Also set --accent-rgb for backgrounds.css
        const rgb = hexToRgbArr(hex);
        root.style.setProperty('--accent-rgb', rgb.join(','));
    }

    const picker = document.getElementById('accent-picker');
    const saved = localStorage.getItem(ACCENT_KEY) || '#0089f1';
    applyAccent(saved);
    if(picker){
        picker.value = saved;
        picker.addEventListener('change', (e)=>{
            const v = e.target.value; localStorage.setItem(ACCENT_KEY, v); applyAccent(v);
        });
    }
})();

// Dropdown toggle for the TMR tag menu
(function(){
    const toggle = document.getElementById('tmr-toggle');
    const menu = document.getElementById('tmr-menu');
    if(!toggle || !menu) return;

    function closeMenu(){
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    }
    function openMenu(){
        menu.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
    }

    toggle.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(menu.hidden) openMenu(); else closeMenu();
    });

    // Close when clicking outside
    document.addEventListener('click', (e)=>{
        if(menu.hidden) return;
        if(!menu.contains(e.target) && !toggle.contains(e.target)) closeMenu();
    });

    // Close on Escape
    document.addEventListener('keydown', (e)=>{
        if(e.key === 'Escape' && !menu.hidden) closeMenu();
    });
})();

/* To-do modal for TMR page (uses same localStorage key 'tmr_todos') */
(function(){
    const TODO_KEY = 'tmr_todos';
    const NOTIFY_KEY = 'tmr_notify_enabled';
    const TODO_DEFAULT_KEY = 'tmr_todo_default_reminder';

    function getNotifyMode(){ return (localStorage.getItem('tmr_notify_mode') || 'both'); }

    function loadTodos(){ try{ return JSON.parse(localStorage.getItem(TODO_KEY) || '[]'); }catch(e){ return []; } }
    function saveTodos(t){ localStorage.setItem(TODO_KEY, JSON.stringify(t));
        try{ window.dispatchEvent(new CustomEvent('tmr:todos:changed', { detail: { count: (Array.isArray(t) ? t.length : loadTodos().length) } })); }catch(e){}
    }
    function generateId(){ return 'td_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

    // Expose Meibot todo creator
    // --- Notification scheduling helpers ---
    const scheduled = new Map(); // key -> timeout id
    function isNotifyEnabled(){ return localStorage.getItem(NOTIFY_KEY) === 'true'; }
    function showSystemNotification(title, opts){
        if(!('Notification' in window)) return;
        if(Notification.permission === 'granted'){
            try{ new Notification(title, opts); }catch(e){}
        }
    }
    const MAX_TIMEOUT = 2147483647; // max 32-bit signed int ms (~24.8 days)
    function scheduleNotification(key, whenMs, title, body){
        cancelScheduled(key);
        if(!isNotifyEnabled()) return;
        if(Notification.permission !== 'granted') return;
        // Respect notification mode: if server-only mode, skip local scheduling
        function getNotifyMode(){ return (localStorage.getItem('tmr_notify_mode') || 'both'); }
        if(getNotifyMode() === 'server') return;
        const delay = whenMs - Date.now();
        if(delay <= 0) return; // already past
        if(delay > MAX_TIMEOUT) return; // too far for setTimeout; skip for now
        const t = setTimeout(()=>{ showSystemNotification(title, { body }); scheduled.delete(key); }, delay);
        scheduled.set(key, t);
    }
    function cancelScheduled(key){ if(scheduled.has(key)){ clearTimeout(scheduled.get(key)); scheduled.delete(key); } }

    function rescheduleAll(){
        // clear existing
        for(const k of Array.from(scheduled.keys())) cancelScheduled(k);
        if(!isNotifyEnabled() || Notification.permission !== 'granted') return;

        // schedule events
        try{
            const evs = JSON.parse(localStorage.getItem('tmr_events') || '[]');
            (evs || []).forEach(ev => {
                if(!ev || !ev.date || !ev.time) return;
                const [y,mo,d] = (ev.date||'').split('-').map(Number);
                const [hh,mm] = (ev.time||'').split(':').map(Number);
                if(Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d) && Number.isFinite(hh)){
                    const ts = new Date(y, mo-1, d, hh||0, mm||0).getTime();
                    scheduleNotification('event_' + ev.id, ts, ev.title || 'Event reminder', ev.notes || ev.title || '');
                }
            });
        }catch(e){}

        // schedule todos with reminderAt
        try{
            const todos = JSON.parse(localStorage.getItem(TODO_KEY) || '[]');
            (todos || []).forEach(t => {
                if(!t || !t.reminderAt) return;
                const ts = Number(t.reminderAt);
                if(!isNaN(ts)) scheduleNotification('todo_' + t.id, ts, 'To-do reminder', t.text || '');
            });
        }catch(e){}
    }

    // Listen for changes to reschedule
    window.addEventListener('tmr:todos:changed', ()=>{ try{ rescheduleAll(); }catch(e){} });
    window.addEventListener('tmr:events:changed', ()=>{ try{ rescheduleAll(); }catch(e){} });
    window.addEventListener('storage', (e)=>{ if(e.key === TODO_KEY || e.key === 'tmr_events' || e.key === NOTIFY_KEY) rescheduleAll(); });


    // Badge updater: keep badge in sync with todos across pages/tabs
    function updateBadge(count){
        const badge = document.getElementById('todo-badge');
        if(!badge) return;
        const c = (typeof count === 'number') ? count : (function(){ try{ return JSON.parse(localStorage.getItem(TODO_KEY)||'[]').length; }catch(e){ return 0; } })();
        if(c > 0){ badge.textContent = String(c); badge.hidden = false; }
        else { badge.hidden = true; }
    }

    // Listen for in-page CustomEvent from calendar.js when todos change
    window.addEventListener('tmr:todos:changed', (e)=>{ try{ updateBadge(e && e.detail && typeof e.detail.count === 'number' ? e.detail.count : undefined); }catch(err){} });

    // Fallback: listen for storage events (cross-tab sync)
    window.addEventListener('storage', (e)=>{ if(e.key === TODO_KEY) updateBadge(); });


    function initTodoModal(){
        // Use the existing side-panel To Do button on TMR.html
        const menuBtn = document.querySelector('.todo-button');
        const backdrop = document.getElementById('todo-modal-backdrop');
        const modalInput = document.getElementById('todo-modal-input');
        const modalAdd = document.getElementById('todo-modal-add');
        const modalClose = document.getElementById('todo-modal-close');
        const modalList = document.getElementById('todo-modal-list');

        if(!menuBtn || !backdrop || !modalInput || !modalAdd || !modalClose || !modalList) return;

        function renderModal(){
            const todos = loadTodos();
            modalList.innerHTML = '';
            todos.forEach(t => {
                const li = document.createElement('li'); li.className = 'todo-item'; li.dataset.id = t.id;
                const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'todo-check';
                cb.addEventListener('change', ()=>{ if(cb.checked){ const remaining = loadTodos().filter(x=>x.id!==t.id); saveTodos(remaining); renderModal(); } });
                const textWrap = document.createElement('div'); textWrap.className = 'todo-text';
                const span = document.createElement('span'); span.textContent = t.text; span.tabIndex = 0;
                span.addEventListener('dblclick', ()=> startEdit());
                span.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') startEdit(); });

                function startEdit(){
                    const inputEl = document.createElement('input'); inputEl.type = 'text'; inputEl.value = t.text;
                    const minutesInput = document.createElement('input'); minutesInput.type = 'number'; minutesInput.min = 0;
                    // prefill minutes if reminder exists
                    if(t.reminderAt){ const mins = Math.max(0, Math.ceil((Number(t.reminderAt) - Date.now())/60000)); minutesInput.value = String(mins); }
                    inputEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter') finishEdit(); if(e.key==='Escape') renderModal(); });
                    function finishEdit(){ const v = inputEl.value.trim(); const mins = parseInt(minutesInput.value,10); if(v){ const all = loadTodos(); const idx = all.findIndex(x=>x.id===t.id); if(idx>=0){ all[idx].text = v; if(!isNaN(mins) && mins > 0){ all[idx].reminderAt = Date.now() + mins*60000; } else { delete all[idx].reminderAt; } saveTodos(all); } renderModal(); } else { renderModal(); } }
                    const saveBtn = document.createElement('button'); saveBtn.className='small-tmr-btn'; saveBtn.textContent='Save'; saveBtn.addEventListener('click', finishEdit);
                    const cancelBtn = document.createElement('button'); cancelBtn.className='small-tmr-btn'; cancelBtn.textContent='Cancel'; cancelBtn.addEventListener('click', renderModal);
                    const minutesLabel = document.createElement('label'); minutesLabel.style.marginLeft = '8px'; minutesLabel.textContent = 'Remind (min): ';
                    minutesLabel.appendChild(minutesInput);
                    textWrap.innerHTML = ''; textWrap.appendChild(inputEl); textWrap.appendChild(minutesLabel); textWrap.appendChild(saveBtn); textWrap.appendChild(cancelBtn); inputEl.focus();
                }

                const actions = document.createElement('div'); actions.className = 'todo-actions';
                const editBtn = document.createElement('button'); editBtn.className='small-tmr-btn'; editBtn.textContent='Edit'; editBtn.addEventListener('click', startEdit);
                const delBtn = document.createElement('button'); delBtn.className='small-tmr-btn'; delBtn.textContent='Delete'; delBtn.addEventListener('click', ()=>{ if(!confirm('Delete this todo?')) return; const remaining = loadTodos().filter(x=>x.id!==t.id); saveTodos(remaining); renderModal(); });
                actions.appendChild(editBtn); actions.appendChild(delBtn);

                textWrap.appendChild(span);
                li.appendChild(cb); li.appendChild(textWrap); li.appendChild(actions);
                modalList.appendChild(li);
            });
        }

        function openModal(){ backdrop.hidden = false; backdrop.classList.add('active'); modalInput.focus(); document.body.style.overflow = 'hidden'; }
        function closeModal(){ backdrop.hidden = true; backdrop.classList.remove('active'); document.body.style.overflow = ''; }

        // Listen for Meibot todo creation and re-render
        window.addEventListener('meibotTodoCreated', () => {
            renderModal(); // Re-render the todo list to show new todo
        });

        menuBtn.addEventListener('click', (e)=>{ e.stopPropagation(); // close dropdown if open
            const menu = document.getElementById('tmr-menu'); if(menu) menu.hidden = true; renderModal(); openModal();
        });

        // notification toggle wiring in the TMR menu
        const notifyToggle = document.getElementById('notify-toggle');
        const notifyDefault = document.getElementById('todo-default-reminder');
        try{
            if(notifyToggle){
                notifyToggle.checked = localStorage.getItem(NOTIFY_KEY) === 'true';
                notifyToggle.addEventListener('change', async (ev)=>{
                    const enabled = !!ev.target.checked;
                    localStorage.setItem(NOTIFY_KEY, enabled ? 'true' : 'false');
                    if(enabled){
                        // request permission
                        if('Notification' in window){
                            const p = await Notification.requestPermission();
                            if(p === 'granted') rescheduleAll();
                        }
                    } else {
                        // clear scheduled
                        rescheduleAll();
                    }
                });
            }
            if(notifyDefault) notifyDefault.value = localStorage.getItem(TODO_DEFAULT_KEY) || notifyDefault.value || '10';
            if(notifyDefault){ notifyDefault.addEventListener('change', (e)=>{ localStorage.setItem(TODO_DEFAULT_KEY, e.target.value); }); }
            // notification mode select (both/local/server)
            const notifyModeEl = document.getElementById('notify-mode');
            try{
                if(notifyModeEl){
                    notifyModeEl.value = localStorage.getItem('tmr_notify_mode') || 'both';
                    notifyModeEl.addEventListener('change', (e)=>{ localStorage.setItem('tmr_notify_mode', e.target.value); });
                }
            }catch(e){}

            // Subscription manager wiring (dev helper)
            const manageSubsBtn = document.getElementById('manage-subs-btn');
            const subBackdrop = document.getElementById('sub-manager-backdrop');
            const subList = document.getElementById('sub-list');
            const subRefresh = document.getElementById('sub-refresh-btn');
            const subClose = document.getElementById('sub-close-btn');
            async function fetchAndRenderSubs(){
                try{
                    const res = await serverFetch('/debug/subscriptions');
                    if(!res || !res.ok) { subList.innerHTML = '<li>No data</li>'; return; }
                    const j = await res.json(); const subs = j && j.subscriptions ? j.subscriptions : [];
                    subList.innerHTML = '';
                    subs.forEach(s => {
                        const li = document.createElement('li'); li.className = 'todo-item';
                        const txt = document.createElement('div'); txt.style.flex = '1'; txt.textContent = (s.subscription && s.subscription.endpoint) ? s.subscription.endpoint : JSON.stringify(s.subscription);
                        const del = document.createElement('button'); del.className='small-tmr-btn'; del.textContent='Delete';
                        del.addEventListener('click', async ()=>{
                            if(!confirm('Delete this subscription?')) return;
                            try{
                                const body = { id: s.id };
                                const r = await serverFetch('/unsubscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
                                if(r && r.ok) { alert('Deleted'); fetchAndRenderSubs(); }
                                else { alert('Delete failed'); }
                            }catch(err){ console.warn('delete failed', err); alert('Delete failed'); }
                        });
                        li.appendChild(txt); li.appendChild(del); subList.appendChild(li);
                    });
                }catch(e){ console.warn('fetch subs failed', e); subList.innerHTML = '<li>Error fetching</li>'; }
            }
            function openSubManager(){ if(!subBackdrop) return; subBackdrop.hidden = false; subBackdrop.classList.add('active'); document.body.style.overflow='hidden'; fetchAndRenderSubs(); }
            function closeSubManager(){ if(!subBackdrop) return; subBackdrop.hidden = true; subBackdrop.classList.remove('active'); document.body.style.overflow=''; }
            if(manageSubsBtn) manageSubsBtn.addEventListener('click', ()=>{ openSubManager(); });
            if(subRefresh) subRefresh.addEventListener('click', (e)=>{ fetchAndRenderSubs(); });
            if(subClose) subClose.addEventListener('click', closeSubManager);
        }catch(e){}

            // Test notification button
            const notifyTestBtn = document.getElementById('notify-test-btn');
            if(notifyTestBtn){
                notifyTestBtn.addEventListener('click', async ()=>{
                    if(!('Notification' in window)){
                        alert('Notifications are not supported by this browser.');
                        return;
                    }
                    if(Notification.permission === 'default'){
                        const perm = await Notification.requestPermission();
                        if(perm !== 'granted'){ alert('Notification permission not granted.'); return; }
                    }
                    if(Notification.permission === 'granted'){
                        try{ showSystemNotification('TMR test', { body: 'This is a test notification.' }); }
                        catch(err){ console.error('Test notification failed', err); alert('Failed to show notification'); }
                    } else {
                        alert('Notification permission not granted.');
                    }
                });
            }

            // --- Service Worker & Push subscription helpers ---
            function urlBase64ToUint8Array(base64String) {
                const padding = '='.repeat((4 - base64String.length % 4) % 4);
                const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
                const rawData = window.atob(base64);
                const outputArray = new Uint8Array(rawData.length);
                for (let i = 0; i < rawData.length; ++i) {
                    outputArray[i] = rawData.charCodeAt(i);
                }
                return outputArray;
            }

            // Helper to call the push server with a fallback to the common dev port (3001).
            // In development the client may be served from a different port than the push server.
            // On HTTPS (ngrok), use same origin. On HTTP (local), try local first, then fall back to ngrok public URL.
            async function serverFetch(path, opts){
                        // If accessing from ngrok public domain, use ngrok push server for HTTPS support
                        if(location.hostname.includes('ngrok')){
                            try{
                                // Use the same ngrok base URL but keep it as-is for push server (port 3001 forwarding)
                                const url = location.origin + path;
                                console.debug('[serverFetch] using ngrok origin', url);
                                const res = await fetch(url, opts);
                                console.debug('[serverFetch] ngrok response', url, res && res.status);
                                return res;
                            }catch(e){ console.debug('[serverFetch] ngrok fetch failed', e); throw e; }
                        }

                        // try same-origin first; log attempts to help debugging
                        try{
                            console.debug('[serverFetch] trying same-origin', path);
                            const res = await fetch(path, opts);
                            if(res){ console.debug('[serverFetch] same-origin response', path, res.status); }
                            // only accept successful responses here — allow fallback to the push server
                            if(res && res.ok) return res;
                        }catch(e){ console.debug('[serverFetch] same-origin fetch failed', e); /* ignore and try fallback */ }

                // fallback to port 3001 on the same host
                try{
                    const base = location && location.hostname ? `${location.protocol}//${location.hostname}:3001` : 'http://localhost:3001';
                    const url = base + (path.startsWith('/') ? path : '/' + path);
                    console.debug('[serverFetch] trying fallback', url);
                    const res2 = await fetch(url, opts);
                    console.debug('[serverFetch] fallback response', url, res2 && res2.status);
                    if(res2 && res2.ok) return res2;
                }catch(e){ console.debug('[serverFetch] fallback fetch failed', e); /* ignore and try ngrok public */ }

                // Last resort: try ngrok public URL for push server (if on local network but need HTTPS for push API)
                try{
                    const url = 'https://sensationistic-taunya-palingenesian.ngrok-free.dev' + (path.startsWith('/') ? path : '/' + path);
                    console.debug('[serverFetch] trying ngrok public fallback', url);
                    const res3 = await fetch(url, opts);
                    console.debug('[serverFetch] ngrok public response', url, res3 && res3.status);
                    return res3;
                }catch(e){ console.debug('[serverFetch] ngrok public fetch failed', e); throw e; }
            }

            async function registerServiceWorkerIfNeeded(){
                if(!('serviceWorker' in navigator)) return null;
                try{
                    const reg = await navigator.serviceWorker.register('/sw.js');
                    console.log('[TMR] Service Worker registered', reg.scope);
                    return reg;
                }catch(err){ console.warn('[TMR] SW register failed', err); return null; }
            }

            async function getVapidKeyFromServer(){
                try{
                    const res = await serverFetch('/vapidPublicKey');
                    if(!res || !res.ok) return null;
                    const j = await res.json();
                    return j && j.publicKey ? j.publicKey : null;
                }catch(e){ return null; }
            }

            async function subscribeForPush(silent=false){
                if(!('serviceWorker' in navigator) || !('PushManager' in window)) { 
                    if(!silent) alert('Push not supported in this browser.'); 
                    return; 
                }
                const reg = await registerServiceWorkerIfNeeded();
                if(!reg) { if(!silent) alert('Service worker registration failed.'); return; }

                try{
                    const existing = await reg.pushManager.getSubscription();
                    if(existing){
                        // Already subscribed — send to server (if not already there) and exit
                        console.log('[TMR] Already subscribed to push');
                        try{ 
                            await serverFetch('/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: existing }) }); 
                        }catch(e){ console.debug('[TMR] Server already has subscription', e); }
                        return;
                    }
                }catch(getSubErr){ console.warn('[TMR] Error checking existing subscription', getSubErr); }

                // Get VAPID public key
                let publicKey = (document.getElementById('vapid-public-input') || {}).value || '';
                if(!publicKey) publicKey = await getVapidKeyFromServer();
                if(!publicKey){ if(!silent) alert('No VAPID public key available.'); return; }

                try{
                    const sub = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(publicKey)
                    });

                    // send to server for storage (with fallback)
                    try{
                        const res = await serverFetch('/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) });
                        if(res && res.ok){ 
                            const j = await res.json(); 
                            localStorage.setItem('tmr_push_sub_id', j.id || ''); 
                            console.log('[TMR] Subscribed for push (id: ' + (j.id||'') + ')');
                            if(!silent) alert('Subscribed for push notifications!'); 
                        }
                        else { if(!silent) alert('Server subscription failed'); }
                    }catch(e){ console.warn('[TMR] send subscription failed', e); if(!silent) alert('Failed to send subscription to server.'); }

                }catch(err){ console.warn('[TMR] subscribe failed', err); if(!silent) alert('Push subscription failed: ' + (err && err.message)); }
            }

            async function unsubscribePush(){
                try{
                    const reg = await navigator.serviceWorker.getRegistration();
                    if(!reg) return;
                    const sub = await reg.pushManager.getSubscription();
                    if(sub){ await sub.unsubscribe(); localStorage.removeItem('tmr_push_sub_id'); alert('Unsubscribed'); }
                }catch(e){ console.warn('unsubscribe failed', e); }
            }

            // Wire push UI buttons
            const pushEnable = document.getElementById('push-enable');
            const pushSubscribeBtn = document.getElementById('push-subscribe-btn');
            if(pushEnable){ pushEnable.checked = !!localStorage.getItem('tmr_push_enabled'); pushEnable.addEventListener('change', (e)=>{ localStorage.setItem('tmr_push_enabled', e.target.checked ? '1' : ''); }); }
            if(pushSubscribeBtn){ pushSubscribeBtn.addEventListener('click', async ()=>{ await subscribeForPush(false); }); }

            // Auto-initialize push on page load: register SW, request permission, subscribe silently
            window.addEventListener('load', async ()=>{
                try{
                    // Step 1: Register Service Worker (always, in background)
                    await registerServiceWorkerIfNeeded();
                    
                    // Step 2: Check if Notification API is supported
                    if(!('Notification' in window)) return;
                    
                    // Step 3: Request permission if not yet decided (first visit)
                    if(Notification.permission === 'default'){
                        console.log('[TMR] Requesting notification permission...');
                        const p = await Notification.requestPermission();
                        if(p !== 'granted') return;
                    }
                    
                    // Step 4: Auto-subscribe silently if permission granted
                    if(Notification.permission === 'granted'){
                        console.log('[TMR] Permission granted, auto-subscribing for push...');
                        await subscribeForPush(true); // silent mode
                    }
                }catch(e){ console.warn('[TMR] Auto-subscribe failed', e); }
            });

            modalAdd.addEventListener('click', ()=>{
            const v = modalInput.value.trim(); if(!v) return;
            // modal-specific minutes input (per-todo)
            const modalMinutesStr = (document.getElementById('todo-modal-minutes') && document.getElementById('todo-modal-minutes').value) || '';
            const defaultMinutesStr = (document.getElementById('todo-default-reminder') && document.getElementById('todo-default-reminder').value) || '0';
            const minutes = modalMinutesStr !== '' ? (parseInt(modalMinutesStr,10) || 0) : (parseInt(defaultMinutesStr,10) || 0);
            const all = loadTodos();
            const item = { id: generateId(), text: v };
            if(minutes > 0){ item.reminderAt = Date.now() + minutes * 60000; }
            all.unshift(item);
            saveTodos(all);
            modalInput.value = '';
            const modalMinEl = document.getElementById('todo-modal-minutes'); if(modalMinEl) modalMinEl.value = '';
            renderModal();
            // schedule immediately if enabled
            try{ rescheduleAll(); }catch(e){}
            // If this todo includes a reminder time, also persist it to the push server so
            // the server-side scheduler will send notifications even if the browser is closed.
            // Only POST to server when user hasn't chosen Local-only mode.
            if(item.reminderAt && getNotifyMode() !== 'local'){
                (async ()=>{
                    try{
                        const payload = { title: 'To-do: ' + (item.text||''), body: item.text || '', deliverAt: Number(item.reminderAt) };
                        const res = await serverFetch('/reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                        if(res && res.ok){ /* optionally handle id from server */ }
                    }catch(err){ console.warn('Failed to persist reminder to server', err); }
                })();
            }
        });
        modalInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') modalAdd.click(); if(e.key==='Escape') { closeModal(); } });
        modalClose.addEventListener('click', closeModal);

        // close when clicking on backdrop outside modal
        backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop) closeModal(); });

        // initial render (keeps sync with other pages)
        renderModal();
        // initialize badge state immediately when modal is initialized
        try{ updateBadge(); }catch(e){}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTodoModal);
    } else {
        initTodoModal();
    }

})();