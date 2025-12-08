/* Mobile Calendar - Separate implementation for phones (max-width: 600px) */
(function() {
    'use strict';
    
    const STORAGE_KEY = 'tmr_events';
    
    // Helper: serverFetch with fallbacks (mirrors TMR.js logic)
    async function serverFetch(path, opts = {}) {
        try {
            const url = location.origin + path;
            try {
                const res = await fetch(url, opts);
                if (res.ok) return res;
            } catch (e) { }
            try {
                const res = await fetch(path, opts);
                if (res.ok) return res;
            } catch (e) { }
            const fallbackUrl = 'http://localhost:3003' + path;
            return await fetch(fallbackUrl, opts);
        } catch (e) {
            console.warn('[calendar-mobile] fetch failed', e);
            throw e;
        }
    }
    
    // Storage helpers
    function loadEvents() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
        catch (e) { return []; }
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
            let deviceId = localStorage.getItem('tmr_device_id');
            if (!deviceId) {
                deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                localStorage.setItem('tmr_device_id', deviceId);
            }
            
            const [y, mo, d] = event.date.split('-').map(Number);
            const [hh, mm] = event.time.split(':').map(Number);
            if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return;
            
            const ts = new Date(y, mo - 1, d, hh || 0, mm || 0).getTime();
            const payload = { 
                deviceId, 
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
        if (idx >= 0) events[idx] = event;
        else events.push(event);
        saveEvents(events);
        postEventReminderToServer(event);
        try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id: event.id } })); } catch (e) { }
    }
    
    function deleteEvent(id) {
        const events = loadEvents().filter(e => e.id !== id);
        saveEvents(events);
        try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id } })); } catch (e) { }
    }
    
    // Expose to window for Meibot
    window.calendarAddOrUpdateEvent = function(event) {
        addOrUpdateEvent(event);
        try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id: event.id } })); } catch (e) { }
        renderMobileCalendar();
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
    const exportBtn = document.getElementById('mobile-export-btn');
    const importBtn = document.getElementById('mobile-import-btn');
    const importFileInput = document.getElementById('mobile-import-file');
    
    // State
    let viewDate = new Date();
    let activeDate = null;
    let activeEventId = null;
    
    function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
    function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
    function formatMonthYear(d) { return d.toLocaleString(undefined, { month: 'long', year: 'numeric' }); }
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function ymd(dateObj) {
        return dateObj.getFullYear() + '-' + pad(dateObj.getMonth() + 1) + '-' + pad(dateObj.getDate());
    }
    
    function renderMobileCalendar() {
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
            
            // Day number
            const dayNum = document.createElement('div');
            dayNum.className = 'mobile-day-number';
            dayNum.textContent = day;
            btn.appendChild(dayNum);
            
            // Event indicators
            const events = eventsForDate(dateStr);
            if (events.length > 0) {
                const indicators = document.createElement('div');
                indicators.className = 'mobile-event-indicators';
                for (let i = 0; i < Math.min(events.length, 3); i++) {
                    const dot = document.createElement('div');
                    dot.className = 'mobile-event-dot';
                    indicators.appendChild(dot);
                }
                btn.appendChild(indicators);
            }
            
            btn.addEventListener('click', () => openModalForDate(dateStr));
            cell.appendChild(btn);
            gridEl.appendChild(cell);
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
        const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
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
    
    function importEventsFromFileObj(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const imported = JSON.parse(reader.result);
                const mode = confirm('Replace existing events? OK = Replace, Cancel = Merge') ? 'replace' : 'merge';
                
                let eventsArr = Array.isArray(imported) ? imported : (imported.events || []);
                const cleaned = eventsArr.map(item => ({
                    id: item.id || ('evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
                    title: String(item.title || '(no title)'),
                    date: String(item.date || ''),
                    time: item.time || '',
                    notes: item.notes || '',
                    color: item.color || '#f19100'
                })).filter(i => /^\d{4}-\d{2}-\d{2}$/.test(i.date));
                
                if (mode === 'replace') {
                    saveEvents(cleaned);
                } else {
                    const existing = loadEvents();
                    const existingIds = new Set(existing.map(e => e.id));
                    const merged = existing.slice();
                    cleaned.forEach(item => {
                        if (!existingIds.has(item.id)) merged.push(item);
                    });
                    saveEvents(merged);
                }
                
                renderMobileCalendar();
                alert('Import successful');
            } catch (err) {
                alert('Import failed: invalid JSON');
            }
        };
        reader.readAsText(file);
    }
    
    // Event listeners
    prevBtn.addEventListener('click', () => {
        viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
        renderMobileCalendar();
    });
    
    nextBtn.addEventListener('click', () => {
        viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
        renderMobileCalendar();
    });
    
    modalCloseBtn.addEventListener('click', closeModal);
    
    exportBtn.addEventListener('click', exportEventsToFile);
    
    importBtn.addEventListener('click', () => importFileInput.click());
    
    importFileInput.addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (!f) return;
        importEventsFromFileObj(f);
        importFileInput.value = '';
    });
    
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
            color: '#f19100'
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
    
    // Initial render
    renderMobileCalendar();
    
    // Listen for event changes
    window.addEventListener('tmr:events:changed', () => {
        renderMobileCalendar();
    });
    
})();
