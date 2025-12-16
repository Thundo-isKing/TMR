
const displayClock = () => {
    const now = new Date();
    let hrs = now.getHours();
    const ampm = hrs >= 12 ? 'PM' : 'AM';
    hrs = hrs % 12;
    hrs = hrs ? hrs : 12; // convert 0 to 12
    const min = String(now.getMinutes()).padStart(2, '0');
    const sec = String(now.getSeconds()).padStart(2, '0');
    
    // Update portrait clock (if present)
    const portraitClock = document.getElementById('clock');
    if (portraitClock) {
        portraitClock.textContent = `${hrs}:${min}:${sec} ${ampm}`;
    }
    
    // Update landscape clock with vertical formatting (if present)
    const landscapeClock = document.getElementById('landscape-clock');
    if (landscapeClock) {
        // Format: 11, . . (dots for seconds), 59, PM
        const hourStr = String(hrs).padStart(2, '0');
        const minStr = String(min).padStart(2, '0');
        const dotStr = ' . . '; // Visual representation of seconds
        
        landscapeClock.innerHTML = `${hourStr}<br>${dotStr}<br>${minStr}<br>${ampm}`;
    }
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

// Add refresh button to menu (CurrentSchedules)
const refreshMenuBtn = document.getElementById('refresh-btn-menu');
if (refreshMenuBtn) {
    refreshMenuBtn.addEventListener('click', () => {
        window.location.reload();
    });
}

// Fullscreen functionality
const toggleFullscreen = async () => {
    try {
        const doc = document.documentElement;
        if (document.fullscreenElement) {
            // Exit fullscreen
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            }
        } else {
            // Enter fullscreen
            if (doc.requestFullscreen) {
                await doc.requestFullscreen();
            } else if (doc.webkitRequestFullscreen) {
                await doc.webkitRequestFullscreen();
            } else if (doc.mozRequestFullScreen) {
                await doc.mozRequestFullScreen();
            } else if (doc.msRequestFullscreen) {
                await doc.msRequestFullscreen();
            }
        }
    } catch (err) {
        console.warn('Fullscreen request failed:', err);
    }
};

// Add fullscreen button to CurrentSchedules
const fullscreenBtnCS = document.getElementById('fullscreen-btn-cs');
if (fullscreenBtnCS) {
    fullscreenBtnCS.addEventListener('click', toggleFullscreen);
}

// Add fullscreen button to TMR page
const fullscreenBtnTMR = document.getElementById('fullscreen-btn-tmr');
if (fullscreenBtnTMR) {
    fullscreenBtnTMR.addEventListener('click', toggleFullscreen);
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
        if(!isNotifyEnabled()) { console.log('[Schedule] Notifications disabled'); return; }
        if(Notification.permission !== 'granted') { console.log('[Schedule] Notification permission not granted:', Notification.permission); return; }
        // Respect notification mode: if server-only mode, skip local scheduling
        function getNotifyMode(){ return (localStorage.getItem('tmr_notify_mode') || 'both'); }
        if(getNotifyMode() === 'server') { console.log('[Schedule] Server-only mode, skipping local'); return; }
        const delay = whenMs - Date.now();
        console.log('[Schedule] Scheduling:', { key, title, body, whenMs: new Date(whenMs), delay, delayMin: Math.round(delay/60000) });
        if(delay <= 0) { console.log('[Schedule] Time is in the past, skipping'); return; } // already past
        if(delay > MAX_TIMEOUT) { console.log('[Schedule] Delay too long:', delay); return; } // too far for setTimeout; skip for now
        const t = setTimeout(()=>{ console.log('[Schedule] Firing notification:', title); showSystemNotification(title, { body }); scheduled.delete(key); }, delay);
        scheduled.set(key, t);
        console.log('[Schedule] Notification scheduled, will fire in', Math.round(delay/1000), 'seconds');
    }
    function cancelScheduled(key){ if(scheduled.has(key)){ clearTimeout(scheduled.get(key)); scheduled.delete(key); } }

    function rescheduleAll(){
        console.log('[rescheduleAll] Starting... NotifyEnabled:', isNotifyEnabled(), 'Permission:', Notification.permission);
        // clear existing
        const clearedCount = scheduled.size;
        for(const k of Array.from(scheduled.keys())) cancelScheduled(k);
        console.log('[rescheduleAll] Cleared', clearedCount, 'scheduled notifications');
        
        if(!isNotifyEnabled()) { console.log('[rescheduleAll] Notifications disabled'); return; }
        if(Notification.permission !== 'granted') { console.log('[rescheduleAll] Permission not granted'); return; }

        // schedule events
        try{
            const evs = JSON.parse(localStorage.getItem('tmr_events') || '[]');
            console.log('[rescheduleAll] Found', evs.length, 'events');
            (evs || []).forEach(ev => {
                if(!ev || !ev.date || !ev.time) return;
                const [y,mo,d] = (ev.date||'').split('-').map(Number);
                const [hh,mm] = (ev.time||'').split(':').map(Number);
                if(Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d) && Number.isFinite(hh)){
                    const ts = new Date(y, mo-1, d, hh||0, mm||0).getTime();
                    scheduleNotification('event_' + ev.id, ts, ev.title || 'Event reminder', ev.notes || ev.title || '');
                }
            });
        }catch(e){ console.error('[rescheduleAll] Event scheduling error:', e); }

        // schedule todos with reminderAt
        try{
            const todos = JSON.parse(localStorage.getItem(TODO_KEY) || '[]');
            console.log('[rescheduleAll] Found', todos.length, 'todos');
            (todos || []).forEach(t => {
                if(!t || !t.reminderAt) { if(t) console.log('[rescheduleAll] Skipping todo (no reminder):', t.id); return; }
                const ts = Number(t.reminderAt);
                console.log('[rescheduleAll] Scheduling todo:', { id: t.id, text: t.text, reminderAt: ts, date: new Date(ts) });
                if(!isNaN(ts)) scheduleNotification('todo_' + t.id, ts, 'To-do reminder', t.text || '');
            });
        }catch(e){ console.error('[rescheduleAll] Todo scheduling error:', e); }
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
        // Get all todo-related elements
        const mobileBtn = document.getElementById('todo-btn-mobile');
        const backdrop = document.getElementById('todo-modal-backdrop');
        const modalInput = document.getElementById('todo-modal-input');
        const modalAdd = document.getElementById('todo-modal-add');
        const modalList = document.getElementById('todo-modal-list');
        
        // Desktop panel elements
        const desktopInput = document.getElementById('todo-input');
        const desktopAdd = document.getElementById('add-todo');
        const desktopList = document.getElementById('todo-list');
        
        // Reminder type and time selectors
        const desktopReminderType = document.getElementById('todo-reminder-type');
        const desktopReminderMinutes = document.getElementById('todo-modal-minutes');
        const desktopReminderTime = document.getElementById('todo-reminder-time');
        const modalReminderType = document.getElementById('todo-modal-reminder-type');
        const modalReminderMinutes = document.getElementById('todo-modal-minutes-input');
        const modalReminderTime = document.getElementById('todo-modal-reminder-time');

        // Check only required elements (no close button needed - handled by switchTab)
        if(!backdrop || !modalInput || !modalAdd || !modalList) return;
        
        // Helper function to calculate reminder timestamp from type and value
        function getReminderTimestamp(reminderType, minutesValue, timeValue) {
            if (reminderType === 'none' || !reminderType) { console.log('[getReminderTimestamp] No reminder type'); return null; }
            
            if (reminderType === 'minutes') {
                const minutes = parseInt(minutesValue, 10);
                if (!isNaN(minutes) && minutes > 0) {
                    const ts = Date.now() + minutes * 60000;
                    console.log('[getReminderTimestamp] Minutes mode:', { minutes, timestamp: ts, date: new Date(ts) });
                    return ts;
                }
                console.log('[getReminderTimestamp] Invalid minutes:', minutesValue);
                return null;
            }
            
            if (reminderType === 'time' && timeValue) {
                const [hours, mins] = timeValue.split(':').map(Number);
                if (!isNaN(hours) && !isNaN(mins)) {
                    const today = new Date();
                    const reminderDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, mins, 0);
                    const now = Date.now();
                    console.log('[getReminderTimestamp] Time mode:', { timeValue, hours, mins, initialTime: reminderDate.getTime(), now, isPast: reminderDate.getTime() < now });
                    // If time is in the past today, schedule for tomorrow
                    if (reminderDate.getTime() < now) {
                        reminderDate.setDate(reminderDate.getDate() + 1);
                        console.log('[getReminderTimestamp] Time was in past, moved to tomorrow:', reminderDate.getTime(), new Date(reminderDate));
                    }
                    return reminderDate.getTime();
                }
                console.log('[getReminderTimestamp] Invalid time format:', timeValue);
            }
            
            return null;
        }
        
        // Setup reminder type selector visibility toggles
        function setupReminderTypeSelector(typeSelect, minutesInput, timeInput) {
            if (!typeSelect) return;
            typeSelect.addEventListener('change', (e) => {
                const type = e.target.value;
                minutesInput.style.display = type === 'minutes' ? 'block' : 'none';
                timeInput.style.display = type === 'time' ? 'block' : 'none';
            });
        }
        
        if (desktopReminderType) setupReminderTypeSelector(desktopReminderType, desktopReminderMinutes, desktopReminderTime);
        if (modalReminderType) setupReminderTypeSelector(modalReminderType, modalReminderMinutes, modalReminderTime);

        // Unified render function that updates BOTH desktop and mobile lists
        function renderTodos(){
            const todos = loadTodos();
            
            // Render to mobile modal list
            modalList.innerHTML = '';
            
            // Render to desktop list (if it exists)
            if(desktopList) desktopList.innerHTML = '';
            
            todos.forEach(t => {
                // Create todo item for mobile modal
                const createTodoLi = () => {
                    const li = document.createElement('li'); li.className = 'todo-item'; li.dataset.id = t.id;
                    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'todo-check';
                    cb.addEventListener('change', ()=>{ if(cb.checked){ const remaining = loadTodos().filter(x=>x.id!==t.id); saveTodos(remaining); renderTodos(); } });
                    const textWrap = document.createElement('div'); textWrap.className = 'todo-text';
                    const span = document.createElement('span'); span.textContent = t.text; span.tabIndex = 0;
                    span.addEventListener('dblclick', ()=> startEdit());
                    span.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') startEdit(); });

                    function startEdit(){
                        const inputEl = document.createElement('input'); inputEl.type = 'text'; inputEl.value = t.text;
                        const reminderTypeSelect = document.createElement('select');
                        reminderTypeSelect.style.padding = '8px';
                        reminderTypeSelect.style.borderRadius = '4px';
                        reminderTypeSelect.style.border = '1px solid #ccc';
                        const optNone = document.createElement('option'); optNone.value = 'none'; optNone.textContent = 'No reminder';
                        const optMin = document.createElement('option'); optMin.value = 'minutes'; optMin.textContent = 'In minutes';
                        const optTime = document.createElement('option'); optTime.value = 'time'; optTime.textContent = 'At time';
                        reminderTypeSelect.appendChild(optNone);
                        reminderTypeSelect.appendChild(optMin);
                        reminderTypeSelect.appendChild(optTime);
                        
                        const minutesInput = document.createElement('input'); minutesInput.type = 'number'; minutesInput.min = 0;
                        minutesInput.style.width = '60px';
                        minutesInput.style.padding = '8px';
                        minutesInput.style.borderRadius = '4px';
                        minutesInput.style.border = '1px solid #ccc';
                        minutesInput.style.display = 'none';
                        
                        const timeInput = document.createElement('input'); timeInput.type = 'time';
                        timeInput.style.padding = '8px';
                        timeInput.style.borderRadius = '4px';
                        timeInput.style.border = '1px solid #ccc';
                        timeInput.style.display = 'none';
                        
                        // prefill if reminder exists
                        if(t.reminderAt){ 
                            const now = Date.now();
                            const reminderMs = Number(t.reminderAt);
                            const minsLeft = Math.max(0, Math.ceil((reminderMs - now)/60000));
                            if (minsLeft < 1440) { // if less than 24 hours, assume it's a relative minutes reminder
                                reminderTypeSelect.value = 'minutes';
                                minutesInput.value = String(minsLeft);
                                minutesInput.style.display = 'block';
                            } else {
                                // assume it's a specific time reminder
                                const reminderDate = new Date(reminderMs);
                                const hours = String(reminderDate.getHours()).padStart(2, '0');
                                const mins = String(reminderDate.getMinutes()).padStart(2, '0');
                                reminderTypeSelect.value = 'time';
                                timeInput.value = hours + ':' + mins;
                                timeInput.style.display = 'block';
                            }
                        }
                        
                        reminderTypeSelect.addEventListener('change', (e) => {
                            minutesInput.style.display = e.target.value === 'minutes' ? 'block' : 'none';
                            timeInput.style.display = e.target.value === 'time' ? 'block' : 'none';
                        });
                        
                        inputEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter') finishEdit(); if(e.key==='Escape') renderTodos(); });
                        function finishEdit(){ 
                            const v = inputEl.value.trim(); 
                            if(v){ 
                                const all = loadTodos(); 
                                const idx = all.findIndex(x=>x.id===t.id); 
                                if(idx>=0){ 
                                    all[idx].text = v;
                                    const reminderType = reminderTypeSelect.value;
                                    const newReminderAt = getReminderTimestamp(reminderType, minutesInput.value, timeInput.value);
                                    if(newReminderAt) { 
                                        all[idx].reminderAt = newReminderAt; 
                                    } else { 
                                        delete all[idx].reminderAt; 
                                    }
                                    saveTodos(all);
                                } 
                            } 
                            renderTodos();
                        }
                        const saveBtn = document.createElement('button'); saveBtn.className='small-tmr-btn'; saveBtn.textContent='Save'; saveBtn.addEventListener('click', finishEdit);
                        const cancelBtn = document.createElement('button'); cancelBtn.className='small-tmr-btn'; cancelBtn.textContent='Cancel'; cancelBtn.addEventListener('click', renderTodos);
                        const reminderWrap = document.createElement('div'); reminderWrap.style.display = 'flex'; reminderWrap.style.gap = '6px'; reminderWrap.style.alignItems = 'center'; reminderWrap.style.marginLeft = '8px';
                        reminderWrap.appendChild(reminderTypeSelect);
                        reminderWrap.appendChild(minutesInput);
                        reminderWrap.appendChild(timeInput);
                        textWrap.innerHTML = ''; textWrap.appendChild(inputEl); textWrap.appendChild(reminderWrap); textWrap.appendChild(saveBtn); textWrap.appendChild(cancelBtn); inputEl.focus();
                    }

                    const actions = document.createElement('div'); actions.className = 'todo-actions';
                    const editBtn = document.createElement('button'); editBtn.className='small-tmr-btn'; editBtn.textContent='Edit'; editBtn.addEventListener('click', startEdit);
                    const delBtn = document.createElement('button'); delBtn.className='small-tmr-btn'; delBtn.textContent='Delete'; delBtn.addEventListener('click', ()=>{ if(!confirm('Delete this todo?')) return; const remaining = loadTodos().filter(x=>x.id!==t.id); saveTodos(remaining); renderTodos(); });
                    actions.appendChild(editBtn); actions.appendChild(delBtn);

                    textWrap.appendChild(span);
                    li.appendChild(cb); li.appendChild(textWrap); li.appendChild(actions);
                    return li;
                };
                
                // Add to mobile modal
                modalList.appendChild(createTodoLi());
                
                // Add to desktop list if it exists
                if(desktopList) desktopList.appendChild(createTodoLi());
            });
        }

        function openModal(){ backdrop.hidden = false; backdrop.classList.add('active'); modalInput.focus(); document.body.style.overflow = 'hidden'; }
        function closeModal(){ backdrop.hidden = true; backdrop.classList.remove('active'); document.body.style.overflow = ''; }

        // Listen for Meibot todo creation and re-render
        window.addEventListener('meibotTodoCreated', () => {
            renderTodos(); // Re-render the todo list to show new todo
        });

        // Mobile button click handler
        if(mobileBtn) {
            mobileBtn.addEventListener('click', (e)=>{ 
                e.stopPropagation(); 
                const menu = document.getElementById('tmr-menu'); if(menu) menu.hidden = true; 
                renderTodos(); 
                openModal();
            });
        }
        
        // Desktop add button handler
        if(desktopAdd && desktopInput) {
            desktopAdd.addEventListener('click', ()=>{
                const text = desktopInput.value.trim();
                if(!text) return;
                const reminderType = desktopReminderType ? desktopReminderType.value : 'none';
                const reminderTimestamp = getReminderTimestamp(reminderType, desktopReminderMinutes.value, desktopReminderTime.value);
                
                const todos = loadTodos();
                const item = { id: Date.now(), text };
                if(reminderTimestamp) item.reminderAt = reminderTimestamp;
                todos.push(item);
                saveTodos(todos);
                desktopInput.value = '';
                if(desktopReminderType) desktopReminderType.value = 'none';
                if(desktopReminderMinutes) desktopReminderMinutes.value = '';
                if(desktopReminderTime) desktopReminderTime.value = '';
                renderTodos();
            });
            desktopInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') desktopAdd.click(); });
        }
        
        // Modal add button handler
        if(modalAdd && modalInput) {
            modalAdd.addEventListener('click', ()=>{
                const text = modalInput.value.trim();
                if(!text) return;
                const todos = loadTodos();
                todos.push({ id: Date.now(), text, reminderAt: null });
                saveTodos(todos);
                modalInput.value = '';
                renderTodos();
            });
            modalInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') modalAdd.click(); });
        }

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
                            // only accept successful responses here ΓÇö allow fallback to the push server
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
                        // Already subscribed ΓÇö send to server (if not already there) and exit
                        console.log('[TMR] Already subscribed to push');
                        try{ 
                            // Get or create device ID
                            let deviceId = localStorage.getItem('tmr_device_id');
                            if (!deviceId) {
                                deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                                localStorage.setItem('tmr_device_id', deviceId);
                            }
                            await serverFetch('/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: existing, userId: deviceId }) }); 
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
                        // Get or create device ID
                        let deviceId = localStorage.getItem('tmr_device_id');
                        if (!deviceId) {
                            deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                            localStorage.setItem('tmr_device_id', deviceId);
                        }
                        const res = await serverFetch('/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub, userId: deviceId }) });
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
            const reminderType = modalReminderType ? modalReminderType.value : 'none';
            const reminderTimestamp = getReminderTimestamp(reminderType, modalReminderMinutes.value, modalReminderTime.value);
            console.log('[modalAdd] Creating todo:', { text: v, reminderType, reminderTimestamp, reminderDate: reminderTimestamp ? new Date(reminderTimestamp) : 'none' });
            
            const all = loadTodos();
            const item = { id: generateId(), text: v };
            if(reminderTimestamp) { item.reminderAt = reminderTimestamp; }
            all.unshift(item);
            saveTodos(all);
            console.log('[modalAdd] Saved todo:', { id: item.id, text: item.text, reminderAt: item.reminderAt });
            modalInput.value = '';
            if(modalReminderType) modalReminderType.value = 'none';
            if(modalReminderMinutes) modalReminderMinutes.value = '';
            if(modalReminderTime) modalReminderTime.value = '';
            renderModal();
            // schedule immediately if enabled
            console.log('[modalAdd] Calling rescheduleAll()...');
            try{ rescheduleAll(); }catch(e){ console.error('[modalAdd] rescheduleAll error:', e); }
            // If this todo includes a reminder time, also persist it to the push server so
            // the server-side scheduler will send notifications even if the browser is closed.
            // Only POST to server when user hasn't chosen Local-only mode.
            if(item.reminderAt && getNotifyMode() !== 'local'){
                (async ()=>{
                    try{
                        const deviceId = localStorage.getItem('tmr_device_id') || 'unknown';
                        const payload = { title: 'To-do: ' + (item.text||''), body: item.text || '', deliverAt: Number(item.reminderAt), deviceId };
                        console.log('[modalAdd] Posting reminder to server:', payload);
                        const res = await serverFetch('/reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                        if(res && res.ok){ console.log('[modalAdd] Server reminder posted successfully'); }
                    }catch(err){ console.warn('[modalAdd] Failed to persist reminder to server', err); }
                })();
            }
        });
        modalInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') modalAdd.click(); if(e.key==='Escape') { closeModal(); } });

        // close when clicking on backdrop outside modal
        backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop) closeModal(); });

        // initial render (keeps sync with other pages)
        renderTodos();
        // initialize badge state immediately when modal is initialized
        try{ updateBadge(); }catch(e){}
    }

    function initMobileTabs() {
        // Get all tab buttons
        const calendarBtn = document.getElementById('calendar-btn-mobile');
        const todoBtn = document.getElementById('todo-btn-mobile');
        const meibotBtn = document.getElementById('meibot-btn-mobile');
        
        // Get all modal/section elements
        const calendarSection = document.querySelector('.calendar-section');
        const todoBackdrop = document.getElementById('todo-modal-backdrop');
        const meibotModal = document.getElementById('meibot-modal');

        if (!calendarBtn || !todoBtn || !meibotBtn) return;

        function switchTab(tabName) {
            // Remove active class from all buttons
            [calendarBtn, todoBtn, meibotBtn].forEach(btn => btn.classList.remove('active'));
            
            // Hide all modals/sections
            if (calendarSection) calendarSection.classList.remove('active');
            if (todoBackdrop) todoBackdrop.classList.remove('active');
            if (meibotModal) meibotModal.classList.remove('active');
            
            // Show selected tab
            switch (tabName) {
                case 'calendar':
                    if (calendarBtn) calendarBtn.classList.add('active');
                    if (calendarSection) calendarSection.classList.add('active');
                    break;
                case 'todo':
                    if (todoBtn) todoBtn.classList.add('active');
                    if (todoBackdrop) {
                        todoBackdrop.classList.add('active');
                        todoBackdrop.hidden = false;
                    }
                    break;
                case 'meibot':
                    if (meibotBtn) meibotBtn.classList.add('active');
                    if (meibotModal) meibotModal.classList.add('active');
                    break;
            }
        }

        // Attach click handlers
        calendarBtn.addEventListener('click', () => switchTab('calendar'));
        todoBtn.addEventListener('click', () => switchTab('todo'));
        meibotBtn.addEventListener('click', () => switchTab('meibot'));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initTodoModal();
            initMobileTabs();
        });
    } else {
        initTodoModal();
        initMobileTabs();
    }

})();

// Export/Import functionality
(function(){
    const exportBtn = document.getElementById('export-data-btn');
    const importBtn = document.getElementById('import-data-btn');
    const importInput = document.getElementById('import-file-input');

    if(exportBtn){
        exportBtn.addEventListener('click', ()=>{
            // Collect all data from localStorage
            const dataToExport = {
                accent: localStorage.getItem('tmr_accent'),
                notifyToggle: localStorage.getItem('notify_toggle'),
                notifyMode: localStorage.getItem('notify_mode'),
                todoDefaultReminder: localStorage.getItem('todo_default_reminder'),
                pushEnable: localStorage.getItem('push_enable'),
                deviceId: localStorage.getItem('tmr_device_id'),
                todos: localStorage.getItem('todos'),
                timestamp: new Date().toISOString()
            };

            // Convert to JSON and download
            const jsonString = JSON.stringify(dataToExport, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tmr-export-${new Date().getTime()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log('Data exported successfully');
        });
    }

    if(importBtn){
        importBtn.addEventListener('click', ()=>{
            importInput.click();
        });
    }

    if(importInput){
        importInput.addEventListener('change', (e)=>{
            const file = e.target.files[0];
            if(!file) return;

            const reader = new FileReader();
            reader.onload = (event)=>{
                try{
                    const data = JSON.parse(event.target.result);
                    
                    // Restore data to localStorage
                    if(data.accent) localStorage.setItem('tmr_accent', data.accent);
                    if(data.notifyToggle) localStorage.setItem('notify_toggle', data.notifyToggle);
                    if(data.notifyMode) localStorage.setItem('notify_mode', data.notifyMode);
                    if(data.todoDefaultReminder) localStorage.setItem('todo_default_reminder', data.todoDefaultReminder);
                    if(data.pushEnable) localStorage.setItem('push_enable', data.pushEnable);
                    if(data.todos) localStorage.setItem('todos', data.todos);
                    
                    console.log('Data imported successfully');
                    alert('Data imported! Page will refresh to apply changes.');
                    window.location.reload();
                }catch(err){
                    console.error('Failed to import data:', err);
                    alert('Failed to import data. Please check the file format.');
                }
            };
            reader.readAsText(file);
            
            // Reset input so same file can be selected again
            e.target.value = '';
        });
    }
})();
