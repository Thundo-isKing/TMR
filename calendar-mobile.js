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

    function __applyOptionalProviderSyncFields(targetObj, sourceObj) {
        if (!targetObj || typeof targetObj !== 'object' || !sourceObj || typeof sourceObj !== 'object') return;

        const addStr = (k) => {
            if (sourceObj[k] == null) return;
            const v = String(sourceObj[k]).trim();
            if (!v) return;
            targetObj[k] = v;
        };

        addStr('provider');
        addStr('externalId');
        addStr('externalCalendarId');
        addStr('syncState');
        addStr('sourceDevice');

        if (sourceObj.lastSyncedAt != null) {
            const n = Number(sourceObj.lastSyncedAt);
            if (Number.isFinite(n) && n > 0) targetObj.lastSyncedAt = n;
        }
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

        // Only include sync metadata when present.
        __applyOptionalProviderSyncFields(payload, localEvent);

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

        // Only include sync metadata when present.
        __applyOptionalProviderSyncFields(payload, localEvent);

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
                    endTime: se.endTime || target.endTime || '',
                    notes: (se.description != null) ? String(se.description) : (target.notes || ''),
                    reminderMinutes: (se.reminderMinutes != null) ? se.reminderMinutes : (target.reminderMinutes || 0),
                    reminderAt: (se.reminderAt != null) ? se.reminderAt : (target.reminderAt || null),
                    lastModified: (se.updatedAt != null) ? se.updatedAt : (target.lastModified || Date.now()),
                    provider: (se.provider != null) ? String(se.provider) : (target.provider != null ? String(target.provider) : null),
                    externalId: (se.externalId != null) ? String(se.externalId) : (target.externalId != null ? String(target.externalId) : null),
                    externalCalendarId: (se.externalCalendarId != null) ? String(se.externalCalendarId) : (target.externalCalendarId != null ? String(target.externalCalendarId) : null),
                    syncState: (se.syncState != null) ? String(se.syncState) : (target.syncState != null ? String(target.syncState) : null),
                    lastSyncedAt: (se.lastSyncedAt != null) ? Number(se.lastSyncedAt) : (target.lastSyncedAt != null ? Number(target.lastSyncedAt) : null),
                    sourceDevice: (se.sourceDevice != null) ? String(se.sourceDevice) : (target.sourceDevice != null ? String(target.sourceDevice) : null)
                };

                if (
                    target.serverId !== next.serverId ||
                    target.title !== next.title ||
                    target.date !== next.date ||
                    target.time !== next.time ||
                    target.endTime !== next.endTime ||
                    target.notes !== next.notes ||
                    target.reminderMinutes !== next.reminderMinutes ||
                    target.reminderAt !== next.reminderAt ||
                    target.lastModified !== next.lastModified ||
                    target.provider !== next.provider ||
                    target.externalId !== next.externalId ||
                    target.externalCalendarId !== next.externalCalendarId ||
                    target.syncState !== next.syncState ||
                    target.lastSyncedAt !== next.lastSyncedAt ||
                    target.sourceDevice !== next.sourceDevice) {
                    changed = true;
                }

                target.serverId = next.serverId;
                target.title = next.title;
                target.date = next.date;
                target.time = next.time;
                target.endTime = next.endTime;
                target.notes = next.notes;
                target.reminderMinutes = next.reminderMinutes;
                target.reminderAt = next.reminderAt;
                target.lastModified = next.lastModified;
                target.provider = next.provider;
                target.externalId = next.externalId;
                target.externalCalendarId = next.externalCalendarId;
                target.syncState = next.syncState;
                                target.lastSyncedAt = next.lastSyncedAt;
                                target.sourceDevice = next.sourceDevice;
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
                    endTime: se.endTime || '',
                    notes: se.description || '',
                    reminderMinutes: se.reminderMinutes || 0,
                    reminderAt: se.reminderAt || null,
                    lastModified: se.updatedAt || Date.now(),
                    provider: se.provider != null ? String(se.provider) : null,
                    externalId: se.externalId != null ? String(se.externalId) : null,
                    externalCalendarId: se.externalCalendarId != null ? String(se.externalCalendarId) : null,
                    syncState: se.syncState != null ? String(se.syncState) : null,
                    lastSyncedAt: se.lastSyncedAt != null ? Number(se.lastSyncedAt) : null,
                    sourceDevice: se.sourceDevice != null ? String(se.sourceDevice) : null,
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

    // Time helpers (mobile)
    const __DAY_HOUR_HEIGHT_PX = 64;
    const __DAY_PX_PER_MIN = __DAY_HOUR_HEIGHT_PX / 60;

    function clamp(n, min, max){
        return Math.max(min, Math.min(max, n));
    }

    function parseHm(hm){
        if(!hm || typeof hm !== 'string') return null;
        const m = hm.match(/^(\d{1,2}):(\d{2})$/);
        if(!m) return null;
        const h = Number(m[1]);
        const mi = Number(m[2]);
        if(!Number.isFinite(h) || !Number.isFinite(mi)) return null;
        if(h < 0 || h > 23 || mi < 0 || mi > 59) return null;
        return h * 60 + mi;
    }
    function minutesToHm(totalMinutes){
        const m = Math.max(0, Math.min(24*60-1, Math.round(totalMinutes)));
        const h = Math.floor(m / 60);
        const mi = m % 60;
        return String(h).padStart(2,'0') + ':' + String(mi).padStart(2,'0');
    }
    function addMinutesToHm(hm, delta){
        const m = parseHm(hm);
        if(m == null) return hm;
        const next = Math.max(0, Math.min(24*60, m + Number(delta || 0)));
        if(next >= 24*60) return '23:59';
        return minutesToHm(next);
    }

    function roundToQuarter(totalMinutes){
        return Math.round(totalMinutes / 15) * 15;
    }
    function normalizeEventTimes(ev, { forceDefaults = false } = {}){
        if(!ev || typeof ev !== 'object') return ev;
        if(ev.time && !ev.endTime && ev.duration != null){
            const dur = Number(ev.duration);
            if(Number.isFinite(dur) && dur > 0) ev.endTime = addMinutesToHm(ev.time, dur);
        }
        if(forceDefaults){
            if(!ev.time) ev.time = '09:00';
            if(!ev.endTime) ev.endTime = addMinutesToHm(ev.time, 60);
        } else {
            if(ev.time && !ev.endTime) ev.endTime = addMinutesToHm(ev.time, 60);
        }
        const sm = parseHm(ev.time);
        const em = parseHm(ev.endTime);
        if(sm != null && (em == null || em <= sm)) ev.endTime = addMinutesToHm(ev.time, 60);
        return ev;
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
        normalizeEventTimes(event, { forceDefaults: true });
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
            try { renderActiveView(); } catch (e) { }
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

    const headerEl = container.querySelector('.mobile-calendar-header');
    const gridContainerEl = container.querySelector('.mobile-calendar-grid-container');
    
    const monthYearEl = container.querySelector('.month-year');
    const prevBtn = document.getElementById('mobile-prev-month');
    const nextBtn = document.getElementById('mobile-next-month');
    const weekdayRowEl = document.getElementById('mobile-weekday-row');
    const gridEl = document.getElementById('mobile-calendar-grid');

    // Mobile Day View refs (timeline)
    const mobileDayViewEl = document.getElementById('mobile-day-view');
    const mobileDayTitleEl = document.getElementById('mobile-day-title');
    const mobileDayBackBtn = document.getElementById('mobile-day-back');
    const mobileDayPrevBtn = document.getElementById('mobile-day-prev');
    const mobileDayNextBtn = document.getElementById('mobile-day-next');
    const mobileDayScrollEl = document.getElementById('mobile-day-view-scroll');
    const mobileDayTimeColEl = document.getElementById('mobile-day-time-col');
    const mobileDayGridEl = document.getElementById('mobile-day-grid');
    const mobileDayGridLinesEl = document.getElementById('mobile-day-grid-lines');
    const mobileDayEventsLayerEl = document.getElementById('mobile-day-events-layer');

    const modalBackdrop = document.getElementById('mobile-modal-backdrop');
    const modalTitle = document.getElementById('mobile-modal-title');
    const eventListEl = document.getElementById('mobile-event-list');
    const eventForm = document.getElementById('mobile-event-form');
    const titleInput = document.getElementById('mobile-event-title');
    const timeInput = document.getElementById('mobile-event-time');
    const endTimeInput = document.getElementById('mobile-event-end-time');
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

    let __mobileViewMode = 'month';
    let __mobileDayViewDateStr = null;
    
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
                    try { showMobileDayView(dateStr); } catch (_) { openModalForDate(dateStr); }
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

    function formatDayTitle(dateStr){
        try{
            const parts = (dateStr || '').split('-').map(Number);
            if(parts.length !== 3) return dateStr;
            const d = new Date(parts[0], parts[1]-1, parts[2]);
            return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
        }catch(_){
            return dateStr;
        }
    }

    function setMobileViewMode(mode){
        __mobileViewMode = (mode === 'day') ? 'day' : 'month';

        if(__mobileViewMode === 'day'){
            if(headerEl) headerEl.hidden = true;
            if(gridContainerEl) gridContainerEl.hidden = true;
            if(mobileDayViewEl) mobileDayViewEl.hidden = false;
        } else {
            if(headerEl) headerEl.hidden = false;
            if(gridContainerEl) gridContainerEl.hidden = false;
            if(mobileDayViewEl) mobileDayViewEl.hidden = true;
        }
    }

    function buildMobileDayViewScaffoldIfNeeded(){
        if(!mobileDayTimeColEl || !mobileDayGridLinesEl) return;
        if(mobileDayTimeColEl.childElementCount === 24 && mobileDayGridLinesEl.childElementCount === (24*4)) return;

        // Time labels
        mobileDayTimeColEl.innerHTML = '';
        for(let h=0; h<24; h++){
            const el = document.createElement('div');
            el.className = 'day-time-label';
            const hour12 = ((h + 11) % 12) + 1;
            const ampm = (h >= 12) ? 'PM' : 'AM';
            el.textContent = hour12 + ' ' + ampm;
            mobileDayTimeColEl.appendChild(el);
        }

        // Grid lines: 15-minute segments
        mobileDayGridLinesEl.innerHTML = '';
        for(let h=0; h<24; h++){
            for(let q=0; q<4; q++){
                const seg = document.createElement('div');
                seg.className = (q === 0) ? 'day-grid-hour' : 'day-grid-quarter';
                mobileDayGridLinesEl.appendChild(seg);
            }
        }
    }

    function renderMobileDayView(dateStr){
        if(!mobileDayEventsLayerEl) return;
        __mobileDayViewDateStr = dateStr;
        if(mobileDayTitleEl) mobileDayTitleEl.textContent = formatDayTitle(dateStr);

        buildMobileDayViewScaffoldIfNeeded();
        mobileDayEventsLayerEl.innerHTML = '';

        const events = eventsForDate(dateStr)
            .map(ev => { normalizeEventTimes(ev); return ev; })
            .filter(ev => !!ev.time && !!ev.endTime)
            .sort((a,b) => {
                const am = parseHm(a.time); const bm = parseHm(b.time);
                if(am == null && bm == null) return 0;
                if(am == null) return 1;
                if(bm == null) return -1;
                return am - bm;
            });

        events.forEach(ev => {
            const sm = parseHm(ev.time);
            const em = parseHm(ev.endTime);
            if(sm == null || em == null) return;

            const top = sm * __DAY_PX_PER_MIN;
            const height = Math.max(28, (em - sm) * __DAY_PX_PER_MIN);

            const block = document.createElement('div');
            block.className = 'day-event';
            block.style.top = top + 'px';
            block.style.height = height + 'px';
            if(ev.color) {
                block.style.background =
                    'radial-gradient(140% 180% at 0% 0%, rgba(255,255,255,0.26), transparent 60%),' +
                    'radial-gradient(140% 180% at 100% 0%, rgba(255,255,255,0.14), transparent 60%),' +
                    'linear-gradient(135deg, rgba(255,255,255,0.10), transparent 45%),' +
                    'color-mix(in srgb, ' + ev.color + ' 45%, rgba(255,255,255,0.10))';
            }

            const title = document.createElement('div');
            title.className = 'day-event-title';
            title.textContent = ev.title || '(no title)';

            const time = document.createElement('div');
            time.className = 'day-event-time';
            time.textContent = (ev.time || '') + ' – ' + (ev.endTime || '');

            block.appendChild(title);
            block.appendChild(time);

            if(ev.notes){
                const notes = document.createElement('div');
                notes.className = 'day-event-notes';
                notes.textContent = String(ev.notes);
                block.appendChild(notes);
            }

            block.addEventListener('click', (e) => {
                e.stopPropagation();
                openModalForDate(dateStr, { suppressList: true, title: 'Edit Event' });
                fillFormForEvent(ev);
            });

            mobileDayEventsLayerEl.appendChild(block);
        });

        // Default scroll to morning
        try{
            if(mobileDayScrollEl && mobileDayScrollEl.scrollTop === 0){
                mobileDayScrollEl.scrollTop = Math.round(8 * __DAY_HOUR_HEIGHT_PX);
            }
        }catch(_){ }
    }

    function showMobileDayView(dateStr){
        if(!mobileDayViewEl) return;
        setMobileViewMode('day');
        renderMobileDayView(dateStr);
    }

    function showMobileMonthView(){
        setMobileViewMode('month');
        try{
            if(__mobileDayViewDateStr){
                const parts = __mobileDayViewDateStr.split('-').map(Number);
                if(parts.length === 3) viewDate = new Date(parts[0], parts[1]-1, 1);
            }
        }catch(_){ }
        renderMobileCalendar();
    }

    function renderActiveView(){
        if(__mobileViewMode === 'day' && __mobileDayViewDateStr){
            renderMobileDayView(__mobileDayViewDateStr);
        } else {
            renderMobileCalendar();
        }
    }
    
    function openModalForDate(dateStr, opts = {}) {
        activeDate = dateStr;
        activeEventId = null;

        const suppressList = !!opts.suppressList;
        const events = suppressList ? [] : eventsForDate(dateStr);

        // Populate (or suppress) event list
        if (eventListEl) {
            eventListEl.innerHTML = '';
            eventListEl.style.display = suppressList ? 'none' : '';
        }

        if (!suppressList && eventListEl && events.length > 0) {
            events.forEach(ev => {
                const item = document.createElement('div');
                item.className = 'mobile-event-item';

                const title = document.createElement('div');
                title.className = 'mobile-event-item-title';
                const start = ev.time || '';
                const end = ev.endTime || '';
                const range = (start && end) ? (start + '–' + end + ' — ') : (start ? (start + ' — ') : '');
                title.textContent = range + (ev.title || '');

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
        if (endTimeInput) endTimeInput.value = '';
        notesInput.value = '';
        
        // Reset color to default
        selectedEventColor = '#ff922b';
        colorBtns.forEach(b => b.classList.remove('selected'));
        const defaultBtn = document.querySelector(`.mobile-color-btn[data-color="#ff922b"]`);
        if (defaultBtn) {
            defaultBtn.classList.add('selected');
        }
        
        deleteBtn.style.display = 'none';
        if (typeof opts.title === 'string' && opts.title) {
            modalTitle.textContent = opts.title;
        } else {
            modalTitle.textContent = suppressList ? 'New Event' : ('Events for ' + dateStr);
        }
        
        // Show modal
        modalBackdrop.classList.add('active');
    }
    
    function fillFormForEvent(ev) {
        normalizeEventTimes(ev);
        activeEventId = ev.id;
        titleInput.value = ev.title || '';
        timeInput.value = ev.time || '';
        if (endTimeInput) endTimeInput.value = ev.endTime || '';
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

        const cleaned = eventsArr.map(item => {
            const ev = {
                id: item.id || ('evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
                title: String(item.title || '(no title)'),
                date: String(item.date || ''),
                time: item.time || item.startTime || '',
                endTime: item.endTime || '',
                notes: item.notes || item.description || '',
                color: item.color || '#ff922b'
            };

            // Preserve optional server/provider sync metadata when present.
            if (item.serverId != null) ev.serverId = item.serverId;
            if (item.reminderMinutes != null) ev.reminderMinutes = Number(item.reminderMinutes) || 0;
            if (item.reminderAt != null) ev.reminderAt = Number(item.reminderAt) || null;
            if (item.lastModified != null) ev.lastModified = Number(item.lastModified) || undefined;
            if (item.provider != null) ev.provider = String(item.provider);
            if (item.externalId != null) ev.externalId = String(item.externalId);
            if (item.externalCalendarId != null) ev.externalCalendarId = String(item.externalCalendarId);
            if (item.syncState != null) ev.syncState = String(item.syncState);
            if (item.lastSyncedAt != null) ev.lastSyncedAt = Number(item.lastSyncedAt) || null;
            if (item.sourceDevice != null) ev.sourceDevice = String(item.sourceDevice);

            // Preserve Google sync metadata if present in exports.
            if (item.googleEventId != null) ev.googleEventId = String(item.googleEventId);
            if (item.googleCalendarId != null) ev.googleCalendarId = String(item.googleCalendarId);
            if (item.syncedFromGoogle != null) ev.syncedFromGoogle = !!item.syncedFromGoogle;

            normalizeEventTimes(ev);
            return ev;
        }).filter(i => /^\d{4}-\d{2}-\d{2}$/.test(i.date));

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

    // Day View navigation (mobile)
    try {
        if (mobileDayBackBtn) mobileDayBackBtn.addEventListener('click', () => showMobileMonthView());
        if (mobileDayPrevBtn) mobileDayPrevBtn.addEventListener('click', () => {
            if(!__mobileDayViewDateStr) __mobileDayViewDateStr = ymd(new Date());
            const parts = __mobileDayViewDateStr.split('-').map(Number);
            const d = new Date(parts[0], parts[1]-1, parts[2]);
            d.setDate(d.getDate() - 1);
            showMobileDayView(ymd(d));
        });
        if (mobileDayNextBtn) mobileDayNextBtn.addEventListener('click', () => {
            if(!__mobileDayViewDateStr) __mobileDayViewDateStr = ymd(new Date());
            const parts = __mobileDayViewDateStr.split('-').map(Number);
            const d = new Date(parts[0], parts[1]-1, parts[2]);
            d.setDate(d.getDate() + 1);
            showMobileDayView(ymd(d));
        });
    } catch (_) { }
    
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
            time: (timeInput && timeInput.value) ? timeInput.value : '09:00',
            endTime: (endTimeInput && endTimeInput.value) ? endTimeInput.value : '',
            notes: notesInput.value || '',
            color: selectedEventColor
        };

        normalizeEventTimes(event, { forceDefaults: true });
        
        addOrUpdateEvent(event);
        closeModal();
        renderActiveView();
    });
    
    deleteBtn.addEventListener('click', () => {
        if (!activeEventId) return;
        if (!confirm('Delete this event?')) return;
        
        deleteEvent(activeEventId);
        closeModal();
        renderActiveView();
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

    // Day View: tap/drag on grid to create an event (snapped to 15 minutes)
    try {
        if (mobileDayGridEl) {
            const drag = {
                active: false,
                pointerId: null,
                startMinutes: 0,
                currentMinutes: 0,
                selectionEl: null
            };

            const ensureSelectionEl = () => {
                if (drag.selectionEl && drag.selectionEl.isConnected) return drag.selectionEl;
                if (!mobileDayEventsLayerEl) return null;
                const el = document.createElement('div');
                el.className = 'day-selection';
                el.style.display = 'none';
                mobileDayEventsLayerEl.appendChild(el);
                drag.selectionEl = el;
                return el;
            };

            const getSnappedMinutesFromPointerEvent = (e) => {
                const rect = mobileDayGridEl.getBoundingClientRect();
                const y = (e.clientY - rect.top);
                const minutesRaw = y / __DAY_PX_PER_MIN;
                return clamp(roundToQuarter(minutesRaw), 0, 24*60);
            };

            const updateSelection = (startMin, endMin) => {
                const el = ensureSelectionEl();
                if (!el) return;
                const s = clamp(Math.min(startMin, endMin), 0, 24*60-15);
                let e = clamp(Math.max(startMin, endMin), 0, 24*60);
                if (e <= s) e = Math.min(24*60, s + 15);
                el.style.display = 'block';
                el.style.top = (s * __DAY_PX_PER_MIN) + 'px';
                el.style.height = Math.max(16, (e - s) * __DAY_PX_PER_MIN) + 'px';
            };

            const hideSelection = () => {
                const el = ensureSelectionEl();
                if (!el) return;
                el.style.display = 'none';
            };

            const openPrefilledModal = (startMin, endMin) => {
                if (!__mobileDayViewDateStr) __mobileDayViewDateStr = ymd(new Date());
                const s = clamp(Math.min(startMin, endMin), 0, 24*60-15);
                let e = clamp(Math.max(startMin, endMin), 0, 24*60);
                if (e <= s) e = Math.min(24*60, s + 15);
                const startHm = minutesToHm(s);
                const endHm = minutesToHm(e);

                openModalForDate(__mobileDayViewDateStr, { suppressList: true, title: 'New Event' });
                if (timeInput) timeInput.value = startHm;
                if (endTimeInput) endTimeInput.value = endHm;
            };

            mobileDayGridEl.addEventListener('pointerdown', (e) => {
                if (!__mobileDayViewDateStr) __mobileDayViewDateStr = ymd(new Date());
                if (e && typeof e.button === 'number' && e.button !== 0) return;
                if (e && e.target && e.target.closest && e.target.closest('.day-event')) return;

                const startMin = getSnappedMinutesFromPointerEvent(e);
                drag.active = true;
                drag.pointerId = e.pointerId;
                drag.startMinutes = clamp(startMin, 0, 24*60-15);
                drag.currentMinutes = drag.startMinutes;
                updateSelection(drag.startMinutes, drag.startMinutes + 15);

                try { mobileDayGridEl.setPointerCapture(e.pointerId); } catch (_) { }
            });

            mobileDayGridEl.addEventListener('pointermove', (e) => {
                if (!drag.active) return;
                if (drag.pointerId != null && e.pointerId !== drag.pointerId) return;
                if (e && e.target && e.target.closest && e.target.closest('.day-event')) return;

                drag.currentMinutes = getSnappedMinutesFromPointerEvent(e);
                updateSelection(drag.startMinutes, drag.currentMinutes);
            });

            const finishDrag = (e) => {
                if (!drag.active) return;
                if (drag.pointerId != null && e && e.pointerId !== drag.pointerId) return;
                drag.active = false;

                try { if (e && e.pointerId != null) mobileDayGridEl.releasePointerCapture(e.pointerId); } catch (_) { }

                const delta = Math.abs((drag.currentMinutes || 0) - (drag.startMinutes || 0));
                hideSelection();

                if (delta >= 15) {
                    openPrefilledModal(drag.startMinutes, drag.currentMinutes);
                } else {
                    // Tap: default to 60 minutes
                    openPrefilledModal(drag.startMinutes, clamp(drag.startMinutes + 60, 0, 24*60));
                }

                drag.pointerId = null;
            };

            const cancelDrag = (e) => {
                if (!drag.active) return;
                if (drag.pointerId != null && e && e.pointerId !== drag.pointerId) return;
                drag.active = false;
                try { if (e && e.pointerId != null) mobileDayGridEl.releasePointerCapture(e.pointerId); } catch (_) { }
                hideSelection();
                drag.pointerId = null;
            };

            mobileDayGridEl.addEventListener('pointerup', finishDrag);
            // If the browser cancels the pointer sequence (commonly due to scrolling), don't open a modal.
            mobileDayGridEl.addEventListener('pointercancel', cancelDrag);
        }
    } catch (_) { }
    
    // Listen for Google Calendar status updates
    window.addEventListener('gcal:status-changed', (e) => {
        const connected = e.detail && e.detail.connected;
        if (gcalAuthBtn) gcalAuthBtn.style.display = connected ? 'none' : 'block';
        if (gcalSyncBtn) gcalSyncBtn.style.display = connected ? 'block' : 'none';
    });
    
    // Initial render (plus short follow-ups to catch late storage writes in this tab)
    renderActiveView();
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
