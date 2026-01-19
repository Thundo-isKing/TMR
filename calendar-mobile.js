/* Mobile Calendar - Separate implementation for phones (max-width: 600px) */
(function() {
    'use strict';

    const __tmrMobileInit = () => {
    
    const STORAGE_KEY = 'tmr_events';
    
    // Helper: serverFetch with fallbacks (mirrors TMR.js logic)
    async function serverFetch(path, opts = {}) {
        try {
            const finalOpts = Object.assign({ credentials: 'include' }, opts);
            const url = location.origin + path;
            try {
                const res = await fetch(url, finalOpts);
                if (res.ok) return res;
            } catch (e) { }
            try {
                const res = await fetch(path, finalOpts);
                if (res.ok) return res;
            } catch (e) { }
            const fallbackUrl = 'http://localhost:3002' + path;
            return await fetch(fallbackUrl, finalOpts);
        } catch (e) {
            console.warn('[calendar-mobile] fetch failed', e);
            throw e;
        }
    }

    function getCurrentUserId() {
        try {
            if (window.AuthClient) {
                if (typeof window.AuthClient.getCurrentUser === 'function') {
                    const u = window.AuthClient.getCurrentUser();
                    if (u && u.id != null) return String(u.id);
                }
                if (typeof window.AuthClient.getUserId === 'function') {
                    const uid = window.AuthClient.getUserId();
                    if (uid != null) return String(uid);
                }
            }
        } catch (e) { }

        try {
            const sid = (sessionStorage.getItem('tmr_last_user_id') || '').trim();
            if (sid) return sid;
        } catch (e) { }
        try {
            const lid = (localStorage.getItem('tmr_last_user_id') || '').trim();
            if (lid) return lid;
        } catch (e) { }
        return null;
    }

    function isAuthed() { return !!getCurrentUserId(); }

    async function fetchServerEvents() {
        const res = await serverFetch('/events', { method: 'GET' });
        if (!res || !res.ok) return [];
        const data = await res.json().catch(() => null);
        return (data && Array.isArray(data.events)) ? data.events : [];
    }

    async function createServerEventFromLocal(localEvent) {
        const payload = {
            title: localEvent.title,
            date: localEvent.date,
            startTime: localEvent.time || localEvent.startTime || null,
            endTime: localEvent.endTime || null,
            description: localEvent.notes || localEvent.description || '',
            reminderMinutes: localEvent.reminderMinutes || 0,
            reminderAt: localEvent.reminderAt || null,
            syncId: localEvent.id || null
        };
        const res = await serverFetch('/events/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: payload })
        });
        if (!res || !res.ok) return null;
        const data = await res.json().catch(() => null);
        return (data && data.eventId != null) ? data.eventId : null;
    }

    async function updateServerEvent(serverId, localEvent) {
        if (serverId == null) return false;
        const payload = {
            title: localEvent.title,
            date: localEvent.date,
            startTime: localEvent.time || localEvent.startTime || null,
            endTime: localEvent.endTime || null,
            description: localEvent.notes || localEvent.description || '',
            reminderMinutes: localEvent.reminderMinutes || 0,
            reminderAt: localEvent.reminderAt || null,
            syncId: localEvent.id || null
        };
        const res = await serverFetch('/events/' + encodeURIComponent(String(serverId)), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: payload })
        });
        return !!(res && res.ok);
    }

    async function deleteServerEvent(serverId) {
        if (serverId == null) return false;
        const res = await serverFetch('/events/' + encodeURIComponent(String(serverId)), { method: 'DELETE' });
        return !!(res && res.ok);
    }

    let __tmrSyncInFlight = null;
    let __tmrLastSyncAt = 0;
    const __tmrSyncMinIntervalMs = 1500;

    async function syncEventsFromServerIfAuthed({ force = false } = {}) {
        const uid = getCurrentUserId();
        if (!uid) return false;

        const now = Date.now();
        if (!force && __tmrSyncInFlight) return __tmrSyncInFlight;
        if (!force && (now - __tmrLastSyncAt) < __tmrSyncMinIntervalMs) return false;
        __tmrLastSyncAt = now;

        __tmrSyncInFlight = (async () => {
        let serverEvents;
        try { serverEvents = await fetchServerEvents(); } catch (e) { return false; }

        const serverBySyncId = new Map();
        for (const se of (serverEvents || [])) {
            if (se && se.syncId != null) serverBySyncId.set(String(se.syncId), se);
        }

        let local;
        try { local = loadEvents(); } catch (e) { local = []; }
        if (!Array.isArray(local)) local = [];

        let changed = false;
        let didCreate = false;
        for (const ev of local) {
            if (!ev || typeof ev !== 'object') continue;
            if (ev.googleEventId || ev.syncedFromGoogle) continue;
            if (ev.serverId != null) continue;
            if (!ev.title || !ev.date) continue;

            const existing = ev.id != null ? serverBySyncId.get(String(ev.id)) : null;
            if (existing && existing.id != null) {
                ev.serverId = existing.id;
                changed = true;
                continue;
            }

            try {
                const newId = await createServerEventFromLocal(ev);
                if (newId != null) {
                    ev.serverId = newId;
                    changed = true;
                    didCreate = true;
                }
            } catch (e) { }
        }

        if (didCreate) {
            try { serverEvents = await fetchServerEvents(); } catch (e) {
                if (changed) { try { saveEvents(local); } catch (_) { } }
                return changed;
            }
        }

        const serverIds = new Set();
        const localByServerId = new Map();
        const localById = new Map();
        for (const ev of local) {
            if (!ev || typeof ev !== 'object') continue;
            if (ev.serverId != null) localByServerId.set(String(ev.serverId), ev);
            if (ev.id != null) localById.set(String(ev.id), ev);
        }

        for (const se of (serverEvents || [])) {
            if (!se || se.id == null) continue;
            serverIds.add(String(se.id));
            const byServer = localByServerId.get(String(se.id));
            const bySync = (se.syncId != null) ? localById.get(String(se.syncId)) : null;
            const target = byServer || bySync;
            if (target) {
                const next = {
                    serverId: se.id,
                    title: se.title || target.title || '',
                    date: se.date || target.date || '',
                    time: se.startTime || target.time || '',
                    notes: (se.description != null) ? String(se.description) : (target.notes || ''),
                    reminderMinutes: (se.reminderMinutes != null) ? se.reminderMinutes : (target.reminderMinutes || 0),
                    reminderAt: (se.reminderAt != null) ? se.reminderAt : (target.reminderAt || null),
                    lastModified: (se.updatedAt != null) ? se.updatedAt : (target.lastModified || Date.now())
                };

                if (
                    target.serverId !== next.serverId ||
                    target.title !== next.title ||
                    target.date !== next.date ||
                    target.time !== next.time ||
                    target.notes !== next.notes ||
                    target.reminderMinutes !== next.reminderMinutes ||
                    target.reminderAt !== next.reminderAt ||
                    target.lastModified !== next.lastModified
                ) {
                    changed = true;
                }

                target.serverId = next.serverId;
                target.title = next.title;
                target.date = next.date;
                target.time = next.time;
                target.notes = next.notes;
                target.reminderMinutes = next.reminderMinutes;
                target.reminderAt = next.reminderAt;
                target.lastModified = next.lastModified;
                if (se.syncId != null && (target.id == null || String(target.id).startsWith('srv_')) && !target.googleEventId) {
                    if (String(target.id) !== String(se.syncId)) changed = true;
                    target.id = String(se.syncId);
                }
            } else {
                changed = true;
                local.push({
                    id: se.syncId != null ? String(se.syncId) : ('srv_' + String(se.id)),
                    serverId: se.id,
                    title: se.title || '',
                    date: se.date || '',
                    time: se.startTime || '',
                    notes: se.description || '',
                    reminderMinutes: se.reminderMinutes || 0,
                    reminderAt: se.reminderAt || null,
                    lastModified: se.updatedAt || Date.now(),
                    ownerUserId: uid
                });
            }
        }

        const filtered = local.filter(ev => {
            if (!ev || typeof ev !== 'object') return false;
            if (ev.googleEventId || ev.syncedFromGoogle) return true;
            if (ev.serverId == null) return true;
            return serverIds.has(String(ev.serverId));
        });

        if (filtered.length !== local.length) changed = true;

        if (changed) {
            try { saveEvents(filtered); } catch (e) { }
        }
        return changed;
        })();

        try {
            return await __tmrSyncInFlight;
        } finally {
            __tmrSyncInFlight = null;
        }
    }
    
    // Storage helpers
    function loadEvents() {
        let events;
        try { events = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
        catch (e) { events = []; }

        // Be defensive: other codepaths may have written a non-array.
        if (!Array.isArray(events)) {
            // Support the export/import payload shape { events: [], todos: [] } if it ever lands here.
            if (events && typeof events === 'object' && Array.isArray(events.events)) {
                events = events.events;
            } else {
                events = [];
            }
        }

        // Ownership tagging/filtering: keep consistent with desktop calendar.
        try {
            const uid = (window.AuthClient && typeof window.AuthClient.getUserId === 'function') ? window.AuthClient.getUserId() : null;
            if (!uid) return events;

            let changed = false;
            const filtered = [];
            for (const ev of events) {
                if (!ev || typeof ev !== 'object') continue;
                if (ev.ownerUserId && String(ev.ownerUserId) !== String(uid)) continue;
                if (!ev.ownerUserId) {
                    ev.ownerUserId = uid;
                    changed = true;
                }
                filtered.push(ev);
            }
            if (changed) {
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered)); } catch (e) { }
            }
            return filtered;
        } catch (e) {
            return events;
        }
    }
    
    function saveEvents(events) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    }
    
    function generateId() {
        return 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }
    
    function eventsForDate(dateStr) {
        return loadEvents().filter(e => e.date === dateStr);
    }
    
    async function postEventReminderToServer(event) {
        if (!event.date || !event.time) return;
        try {
            const subscriptionId = localStorage.getItem('tmr_push_sub_id');
            if (!subscriptionId) {
                console.warn('[calendar-mobile] No subscription ID available - event reminder will not be delivered');
                return;
            }
            
            const [y, mo, d] = event.date.split('-').map(Number);
            const [hh, mm] = event.time.split(':').map(Number);
            if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return;
            
            const ts = new Date(y, mo - 1, d, hh || 0, mm || 0).getTime();
            const payload = { 
                subscriptionId: Number(subscriptionId), 
                userId: getCurrentUserId() || null, 
                title: 'Event: ' + (event.title || ''), 
                body: event.notes || event.title || '', 
                deliverAt: ts 
            };
            await serverFetch('/reminder', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(payload) 
            });
        } catch (err) {
            console.warn('[calendar-mobile] failed to post event reminder', err);
        }
    }
    
    function addOrUpdateEvent(event) {
        const events = loadEvents();
        const idx = events.findIndex(e => e.id === event.id);

        // Align with desktop: timestamp + ownership when available.
        try { event.lastModified = Date.now(); } catch (e) { }
        try {
            const uid = (window.AuthClient && typeof window.AuthClient.getUserId === 'function') ? window.AuthClient.getUserId() : null;
            if (uid) event.ownerUserId = uid;
        } catch (e) { }

        if (idx >= 0) events[idx] = event;
        else events.push(event);
        saveEvents(events);
        try {
            if (isAuthed() && !(event.googleEventId || event.syncedFromGoogle)) {
                if (event.serverId != null) {
                    updateServerEvent(event.serverId, event).catch(() => { });
                } else {
                    createServerEventFromLocal(event).then((newId) => {
                        if (newId != null) {
                            const after = loadEvents();
                            const ix = after.findIndex(e => e && e.id === event.id);
                            if (ix >= 0) { after[ix].serverId = newId; saveEvents(after); }
                            try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id: event.id, synced: true } })); } catch (e) { }
                        }
                    }).catch(() => { });
                }
            } else {
                postEventReminderToServer(event);
            }
        } catch (e) { }
        try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id: event.id } })); } catch (e) { }
    }
    
    function deleteEvent(id) {
        const all = loadEvents();
        const eventToDelete = all.find(e => e && e.id === id);
        const events = all.filter(e => e.id !== id);
        try {
            if (eventToDelete && eventToDelete.serverId != null && isAuthed() && !(eventToDelete.googleEventId || eventToDelete.syncedFromGoogle)) {
                deleteServerEvent(eventToDelete.serverId).catch(() => { });
            }
        } catch (e) { }
        saveEvents(events);
        try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id } })); } catch (e) { }
    }

    // Debounced render helper: avoids repeated full grid rebuilds during bursts
    // (storage/visibility/focus changes, sync callbacks, etc.)
    let __renderQueued = false;
    function scheduleRender() {
        if (__renderQueued) return;
        __renderQueued = true;

        const run = () => {
            __renderQueued = false;
            try { renderMobileCalendar(); } catch (e) { }
        };

        try {
            window.requestAnimationFrame(run);
        } catch (e) {
            setTimeout(run, 0);
        }
    }
    
    // Expose to window for Meibot
    window.calendarAddOrUpdateEvent = function(event) {
        addOrUpdateEvent(event);
        try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id: event.id } })); } catch (e) { }
        scheduleRender();
    };
    
    // DOM refs
    const container = document.getElementById('mobile-calendar-container');
    if (!container) return; // mobile calendar not on page
    
    const monthYearEl = container.querySelector('.month-year');
    const prevBtn = document.getElementById('mobile-prev-month');
    const nextBtn = document.getElementById('mobile-next-month');
    const weekdayRowEl = document.getElementById('mobile-weekday-row');
    const gridEl = document.getElementById('mobile-calendar-grid');
    const modalBackdrop = document.getElementById('mobile-modal-backdrop');
    const modalTitle = document.getElementById('mobile-modal-title');
    const eventListEl = document.getElementById('mobile-event-list');
    const eventForm = document.getElementById('mobile-event-form');
    const titleInput = document.getElementById('mobile-event-title');
    const timeInput = document.getElementById('mobile-event-time');
    const notesInput = document.getElementById('mobile-event-notes');
    const deleteBtn = document.getElementById('mobile-delete-btn');
    const modalCloseBtn = document.getElementById('mobile-modal-close');
    const gcalAuthBtn = document.getElementById('mobile-gcal-auth-btn');
    const gcalSyncBtn = document.getElementById('mobile-gcal-sync-btn');
    const colorBtns = document.querySelectorAll('.mobile-color-btn');
    
    // State
    let viewDate = new Date();
    let activeDate = null;
    let activeEventId = null;
    let selectedEventColor = '#ff922b'; // Default color (orange)
    
    function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
    function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
    function formatMonthYear(d) { return d.toLocaleString(undefined, { month: 'long', year: 'numeric' }); }
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function ymd(dateObj) {
        return dateObj.getFullYear() + '-' + pad(dateObj.getMonth() + 1) + '-' + pad(dateObj.getDate());
    }
    
    function renderMobileCalendar() {
        try {
            // Snapshot events once per render to avoid repeated JSON.parse calls.
            const allEvents = loadEvents();
            const byDate = new Map();
            for (const ev of allEvents) {
                if (!ev || typeof ev !== 'object') continue;
                if (!ev.date) continue;
                if (!byDate.has(ev.date)) byDate.set(ev.date, []);
                byDate.get(ev.date).push(ev);
            }

            // Update month/year
            monthYearEl.textContent = formatMonthYear(viewDate);
        
            // Render weekday headers
            weekdayRowEl.innerHTML = '';
            const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            weekdays.forEach(w => {
                const el = document.createElement('div');
                el.className = 'mobile-weekday';
                el.textContent = w;
                weekdayRowEl.appendChild(el);
            });
        
            // Render calendar grid
            gridEl.innerHTML = '';
            const first = startOfMonth(viewDate);
            const last = endOfMonth(viewDate);
            const startWeekday = first.getDay();
            const totalDays = last.getDate();
        
            // Blank cells before month
            for (let i = 0; i < startWeekday; i++) {
                const cell = document.createElement('div');
                cell.className = 'mobile-calendar-cell';
                gridEl.appendChild(cell);
            }
        
            // Calendar days
            for (let day = 1; day <= totalDays; day++) {
                const d = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
                const dateStr = ymd(d);

                const cell = document.createElement('div');
                cell.className = 'mobile-calendar-cell';

                const btn = document.createElement('button');
                btn.className = 'mobile-calendar-day';
                btn.type = 'button';
                btn.setAttribute('data-date', dateStr);

                // Check if this is today
                const today = new Date();
                const todayStr = ymd(today);
                if (dateStr === todayStr) {
                    btn.classList.add('today');
                }

                // Day number
                const dayNum = document.createElement('div');
                dayNum.className = 'mobile-day-number';
                dayNum.textContent = day;
                btn.appendChild(dayNum);

                // Event indicators
                const events = byDate.get(dateStr) || [];
                if (events.length > 0) {
                    const indicators = document.createElement('div');
                    indicators.className = 'mobile-event-indicators';
                    for (let i = 0; i < Math.min(events.length, 3); i++) {
                        const dot = document.createElement('div');
                        dot.className = 'mobile-event-dot';
                        dot.style.background = (typeof events[i].color === 'string' && events[i].color) ? events[i].color : '#ff922b';
                        indicators.appendChild(dot);
                    }
                    btn.appendChild(indicators);
                }

                btn.addEventListener('click', () => {
                    openModalForDate(dateStr);
                    // Some codepaths may write to localStorage without emitting an in-tab
                    // notification; ensure day indicators catch up when the user interacts.
                    scheduleRender();
                });
                cell.appendChild(btn);
                gridEl.appendChild(cell);
            }
        } catch (err) {
            console.error('[calendar-mobile] renderMobileCalendar failed', err);
        }
    }
    
    function openModalForDate(dateStr) {
        activeDate = dateStr;
        activeEventId = null;
        const events = eventsForDate(dateStr);
        
        // Populate event list
        eventListEl.innerHTML = '';
        if (events.length > 0) {
            events.forEach(ev => {
                const item = document.createElement('div');
                item.className = 'mobile-event-item';
                
                const title = document.createElement('div');
                title.className = 'mobile-event-item-title';
                title.textContent = (ev.time ? (ev.time + ' — ') : '') + ev.title;
                
                const btn = document.createElement('button');
                btn.className = 'mobile-event-item-btn';
                btn.textContent = 'Edit';
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    fillFormForEvent(ev);
                });
                
                item.appendChild(title);
                item.appendChild(btn);
                eventListEl.appendChild(item);
            });
        }
        
        // Reset form
        titleInput.value = '';
        timeInput.value = '';
        notesInput.value = '';
        
        // Reset color to default
        selectedEventColor = '#ff922b';
        colorBtns.forEach(b => b.classList.remove('selected'));
        const defaultBtn = document.querySelector(`.mobile-color-btn[data-color="#ff922b"]`);
        if (defaultBtn) {
            defaultBtn.classList.add('selected');
        }
        
        deleteBtn.style.display = 'none';
        modalTitle.textContent = 'Events for ' + dateStr;
        
        // Show modal
        modalBackdrop.classList.add('active');
    }
    
    function fillFormForEvent(ev) {
        activeEventId = ev.id;
        titleInput.value = ev.title || '';
        timeInput.value = ev.time || '';
        notesInput.value = ev.notes || '';
        
        // Restore color when editing
        if (ev.color) {
            selectedEventColor = ev.color;
            const matchingBtn = document.querySelector(`.mobile-color-btn[data-color="${ev.color}"]`);
            if (matchingBtn) {
                colorBtns.forEach(b => b.classList.remove('selected'));
                matchingBtn.classList.add('selected');
            }
        } else {
            selectedEventColor = '#ff922b';
        }
        
        deleteBtn.style.display = 'block';
        modalTitle.textContent = 'Edit Event';
    }
    
    function closeModal() {
        modalBackdrop.classList.remove('active');
        activeDate = null;
        activeEventId = null;
    }
    
    function exportEventsToFile() {
        const events = loadEvents();
        // include todos in the export so calendar and todos can be imported together
        let todos = [];
        try { todos = JSON.parse(localStorage.getItem('tmr_todos') || '[]'); } catch (e) { todos = []; }
        const payload = { events: events, todos: todos };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const name = 'tmr-export-' + new Date().toISOString().slice(0, 10) + '.json';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }
    
    function importEventsFromArray(arrOrObj, mode = 'merge') {
        // Accept older-format array (events only) or new object { events: [], todos: [] }
        let eventsArr = [];
        let todosArr = null;
        if (Array.isArray(arrOrObj)) {
            eventsArr = arrOrObj;
        } else if (arrOrObj && typeof arrOrObj === 'object') {
            eventsArr = Array.isArray(arrOrObj.events) ? arrOrObj.events : [];
            todosArr = Array.isArray(arrOrObj.todos) ? arrOrObj.todos : null;
        } else {
            throw new Error('Imported JSON must be an array or an object with { events, todos }');
        }

        const cleaned = eventsArr.map(item => ({
            id: item.id || ('evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
            title: String(item.title || '(no title)'),
            date: String(item.date || ''),
            time: item.time || '',
            notes: item.notes || '',
            color: item.color || '#ff922b'
        })).filter(i => /^\d{4}-\d{2}-\d{2}$/.test(i.date));

        if (mode === 'replace') {
            saveEvents(cleaned);
        } else {
            const existing = loadEvents();
            const existingIds = new Set(existing.map(e => e.id));
            const merged = existing.slice();
            cleaned.forEach(item => {
                if (!existingIds.has(item.id)) merged.push(item);
                else {
                    const duplicate = existing.find(e => e.date === item.date && e.title === item.title && e.time === item.time);
                    if (!duplicate) {
                        item.id = 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                        merged.push(item);
                    }
                }
            });
            saveEvents(merged);
        }

        // If todos were included, import them as well
        if (todosArr !== null) {
            try {
                const cleanedTodos = todosArr.map(t => ({ 
                    id: t.id || ('td_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)), 
                    text: String(t.text || ''), 
                    reminderAt: t.reminderAt || undefined 
                })).filter(x => x.text && x.text.length > 0);
                if (mode === 'replace') {
                    localStorage.setItem('tmr_todos', JSON.stringify(cleanedTodos));
                    try { window.dispatchEvent(new CustomEvent('tmr:todos:changed', { detail: { count: cleanedTodos.length } })); } catch (e) { }
                } else {
                    const existingTodos = (function () { try { return JSON.parse(localStorage.getItem('tmr_todos') || '[]'); } catch (e) { return []; } })();
                    const existingIds = new Set(existingTodos.map(t => t.id));
                    const mergedTodos = existingTodos.slice();
                    cleanedTodos.forEach(t => { if (!existingIds.has(t.id)) mergedTodos.push(t); });
                    localStorage.setItem('tmr_todos', JSON.stringify(mergedTodos));
                    try { window.dispatchEvent(new CustomEvent('tmr:todos:changed', { detail: { count: mergedTodos.length } })); } catch (e) { }
                }
            } catch (e) { /* ignore todos import errors */ }
        }
    }

    function importEventsFromFileObj(file, mode = 'merge') {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const imported = JSON.parse(reader.result);
                importEventsFromArray(imported, mode);
                renderMobileCalendar();
                // notify todo listeners in case todos were included
                try { window.dispatchEvent(new CustomEvent('tmr:imports:done', { detail: {} })); } catch (e) { }
                alert('Import successful');
            } catch (err) { alert('Import failed: invalid JSON'); }
        };
        reader.readAsText(file);
    }
    
    function triggerMobileMonthTransition() {
        gridEl.classList.add('month-transition');
        renderMobileCalendar();
        setTimeout(() => {
            gridEl.classList.remove('month-transition');
        }, 350);
    }
    
    // Event listeners
    prevBtn.addEventListener('click', () => {
        viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
        triggerMobileMonthTransition();
    });
    
    nextBtn.addEventListener('click', () => {
        viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
        triggerMobileMonthTransition();
    });
    
    modalCloseBtn.addEventListener('click', closeModal);
    
    // Color picker button handlers
    colorBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            selectedEventColor = btn.dataset.color;
            // Visual feedback: highlight selected color
            colorBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });
    
    // Google Calendar buttons
    if (gcalAuthBtn) {
        gcalAuthBtn.addEventListener('click', () => {
            if (window.GoogleCalendarClient && window.GoogleCalendarClient.initiateAuth) {
                window.GoogleCalendarClient.initiateAuth();
            } else {
                console.warn('[mobile] Google Calendar API not available');
            }
        });
    }
    
    if (gcalSyncBtn) {
        gcalSyncBtn.addEventListener('click', () => {
            if (window.GoogleCalendarClient && window.GoogleCalendarClient.manualSync) {
                window.GoogleCalendarClient.manualSync();
            } else {
                console.warn('[mobile] Google Calendar API not available');
            }
        });
    }
    
    // Form submission
    eventForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        if (!activeDate) return;
        
        const event = {
            id: activeEventId || generateId(),
            title: titleInput.value.trim() || '(no title)',
            date: activeDate,
            time: timeInput.value || '',
            notes: notesInput.value || '',
            color: selectedEventColor
        };
        
        addOrUpdateEvent(event);
        closeModal();
        renderMobileCalendar();
    });
    
    deleteBtn.addEventListener('click', () => {
        if (!activeEventId) return;
        if (!confirm('Delete this event?')) return;
        
        deleteEvent(activeEventId);
        closeModal();
        renderMobileCalendar();
    });
    
    // Cancel button
    const cancelBtn = eventForm.querySelector('.mobile-cancel-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeModal();
        });
    }
    
    // Escape to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalBackdrop.classList.contains('active')) {
            closeModal();
        }
    });
    
    // Listen for Google Calendar status updates
    window.addEventListener('gcal:status-changed', (e) => {
        const connected = e.detail && e.detail.connected;
        if (gcalAuthBtn) gcalAuthBtn.style.display = connected ? 'none' : 'block';
        if (gcalSyncBtn) gcalSyncBtn.style.display = connected ? 'block' : 'none';
    });
    
    // Initial render (plus short follow-ups to catch late storage writes in this tab)
    renderMobileCalendar();
    // Best-effort: pull latest server events for multi-device sync.
    try {
        syncEventsFromServerIfAuthed().then((did) => {
            if (did) try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { synced: true } })); } catch (e) { }
        }).catch(() => { });
    } catch (e) { }
    setTimeout(scheduleRender, 50);
    setTimeout(scheduleRender, 500);
    
    // Listen for event changes
    window.addEventListener('tmr:events:changed', () => {
        scheduleRender();
    });

    // Cross-tab updates and common mobile lifecycle restores.
    window.addEventListener('storage', (e) => {
        if (e && e.key === STORAGE_KEY) scheduleRender();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) scheduleRender();
    });
    window.addEventListener('pageshow', () => {
        scheduleRender();
    });
    window.addEventListener('focus', () => {
        try {
            syncEventsFromServerIfAuthed().then((did) => {
                if (did) try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { synced: true } })); } catch (e) { }
            }).catch(() => { });
        } catch (e) { }
        scheduleRender();
    });
    
    // Check hourly for day changes to update today styling
    setInterval(() => {
        scheduleRender();
    }, 3600000); // 1 hour in milliseconds

    // Light periodic refresh while open.
    setInterval(() => {
        try {
            syncEventsFromServerIfAuthed().then((did) => {
                if (did) try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { synced: true } })); } catch (e) { }
            }).catch(() => { });
        } catch (e) { }
    }, 60000);
    
    };

    const __tmrStart = () => {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', __tmrMobileInit, { once: true });
        } else {
            __tmrMobileInit();
        }
    };

    if (typeof window !== 'undefined' && window.AuthClient && window.AuthClient.ready && typeof window.AuthClient.ready.then === 'function') {
        window.AuthClient.ready.then(__tmrStart).catch(__tmrStart);
    } else {
        __tmrStart();
    }

})();
