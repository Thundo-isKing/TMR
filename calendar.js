/* Minimal calendar implementation using localStorage (key: tmr_events)
   Features: month grid, prev/next navigation, add/edit/delete events via modal.
   Event model: { id, title, date (YYYY-MM-DD), time, notes, color }
*/
/* eslint-disable no-undef */
(function(){
  const __tmrCalendarInit = () => {
  const STORAGE_KEY = 'tmr_events';

  // Helper: serverFetch with fallbacks (mirrors TMR.js logic)
  async function serverFetch(path, opts={}){
    try{
      const finalOpts = Object.assign({ credentials: 'include' }, opts);
      if(location.hostname.includes('ngrok')){
        const url = location.origin + path;
        try{
          const res = await fetch(url, finalOpts);
          if(res.ok) return res;
        }catch(e){ console.debug('[calendar.serverFetch] ngrok fetch failed', e); }
      }
      try{
        const res = await fetch(path, finalOpts);
        if(res.ok) return res;
      }catch(e){ /* try fallback */ }
      const url = 'http://localhost:3002' + path;
      const res = await fetch(url, finalOpts);
      return res;
    }catch(e){
      console.warn('[calendar.serverFetch] all attempts failed', e);
      throw e;
    }
  }

  function getCurrentUserId(){
    try{
      if(window.AuthClient){
        if(typeof window.AuthClient.getCurrentUser === 'function'){
          const u = window.AuthClient.getCurrentUser();
          if(u && u.id != null) return String(u.id);
        }
        if(typeof window.AuthClient.getUserId === 'function'){
          const uid = window.AuthClient.getUserId();
          if(uid != null) return String(uid);
        }
      }
    }catch(e){}

    try{
      const sid = (sessionStorage.getItem('tmr_last_user_id') || '').trim();
      if(sid) return sid;
    }catch(e){}
    try{
      const lid = (localStorage.getItem('tmr_last_user_id') || '').trim();
      if(lid) return lid;
    }catch(e){}
    return null;
  }

  function isAuthed(){
    return !!getCurrentUserId();
  }

  async function fetchServerEvents(){
    const res = await serverFetch('/events', { method: 'GET' });
    if(!res || !res.ok) return [];
    const data = await res.json().catch(()=>null);
    return (data && Array.isArray(data.events)) ? data.events : [];
  }

  async function createServerEventFromLocal(localEvent){
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
    if(!res || !res.ok) return null;
    const data = await res.json().catch(()=>null);
    const id = data && data.eventId != null ? data.eventId : null;
    return id;
  }

  async function updateServerEvent(serverId, localEvent){
    if(serverId == null) return false;
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

  async function deleteServerEvent(serverId){
    if(serverId == null) return false;
    const res = await serverFetch('/events/' + encodeURIComponent(String(serverId)), { method: 'DELETE' });
    return !!(res && res.ok);
  }

  let __tmrSyncInFlight = null;
  let __tmrLastSyncAt = 0;
  const __tmrSyncMinIntervalMs = 1500;

  async function syncEventsFromServerIfAuthed({ force = false } = {}){
    const uid = getCurrentUserId();
    if(!uid) return false;

    const now = Date.now();
    if(!force && __tmrSyncInFlight) return __tmrSyncInFlight;
    if(!force && (now - __tmrLastSyncAt) < __tmrSyncMinIntervalMs) return false;
    __tmrLastSyncAt = now;

    __tmrSyncInFlight = (async () => {
      let serverEvents;
      try{
        serverEvents = await fetchServerEvents();
      }catch(e){
        return false;
      }

    const serverBySyncId = new Map();
    for(const se of (serverEvents || [])){
      if(se && se.syncId != null) serverBySyncId.set(String(se.syncId), se);
    }

    // Upload legacy local-only events (no serverId) that aren't Google-synced.
    let local;
    try{ local = loadEvents(); }catch(e){ local = []; }
    if(!Array.isArray(local)) local = [];

    let changed = false;
    let didCreate = false;
    for(const ev of local){
      if(!ev || typeof ev !== 'object') continue;
      if(ev.googleEventId || ev.syncedFromGoogle) continue;
      if(ev.serverId != null) continue;
      if(!ev.title || !ev.date) continue;

      const existing = ev.id != null ? serverBySyncId.get(String(ev.id)) : null;
      if(existing && existing.id != null){
        ev.serverId = existing.id;
        changed = true;
        continue;
      }

      try{
        const newId = await createServerEventFromLocal(ev);
        if(newId != null){
          ev.serverId = newId;
          changed = true;
          didCreate = true;
        }
      }catch(e){ /* keep local-only */ }
    }

    // Re-fetch after any creates so we merge the canonical list.
    if(didCreate){
      try{
        serverEvents = await fetchServerEvents();
      }catch(e){
        if(changed){
          try{ saveEvents(local); }catch(_){ }
        }
        return changed;
      }
    }

    const serverIds = new Set();
    const localByServerId = new Map();
    const localById = new Map();
    for(const ev of local){
      if(!ev || typeof ev !== 'object') continue;
      if(ev.serverId != null) localByServerId.set(String(ev.serverId), ev);
      if(ev.id != null) localById.set(String(ev.id), ev);
    }

    for(const se of (serverEvents || [])){
      if(!se || se.id == null) continue;
      serverIds.add(String(se.id));
      const byServer = localByServerId.get(String(se.id));
      const bySync = (se.syncId != null) ? localById.get(String(se.syncId)) : null;
      const target = byServer || bySync;
      if(target){
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

        if(
          target.serverId !== next.serverId ||
          target.title !== next.title ||
          target.date !== next.date ||
          target.time !== next.time ||
          target.notes !== next.notes ||
          target.reminderMinutes !== next.reminderMinutes ||
          target.reminderAt !== next.reminderAt ||
          target.lastModified !== next.lastModified
        ){
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
        // Only adopt syncId as local id when we created a synthetic local id for a server-only event.
        if(se.syncId != null && (target.id == null || String(target.id).startsWith('srv_')) && !target.googleEventId){
          if(String(target.id) !== String(se.syncId)) changed = true;
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

    // Remove local events that were server-backed but no longer exist server-side.
    const filtered = local.filter(ev => {
      if(!ev || typeof ev !== 'object') return false;
      if(ev.googleEventId || ev.syncedFromGoogle) return true;
      if(ev.serverId == null) return true;
      return serverIds.has(String(ev.serverId));
    });

    if(filtered.length !== local.length) changed = true;

    if(changed){
      try{ saveEvents(filtered); }catch(e){}
    }
    return changed;
    })();

    try{
      return await __tmrSyncInFlight;
    }finally{
      __tmrSyncInFlight = null;
    }
  }

  // Helpers
  function loadEvents(){
    let events;
    try{ events = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch(e){ events = []; }

    // Ownership tagging and filtering.
    // - If we're logged in, ensure events in this user's namespace are tagged with ownerUserId.
    // - Never show events explicitly tagged to a different user.
    try {
      const uid = (window.AuthClient && typeof window.AuthClient.getUserId === 'function') ? window.AuthClient.getUserId() : null;
      if (!uid) return Array.isArray(events) ? events : [];
      if (!Array.isArray(events)) events = [];

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
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered)); } catch (e) {}
      }
      return filtered;
    } catch (e) {
      return Array.isArray(events) ? events : [];
    }
  }
  function saveEvents(events){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }
  function generateId(){
    return 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  }
  function eventsForDate(dateStr){
    return loadEvents().filter(e => e.date === dateStr);
  }
  async function postEventReminderToServer(event){
    // If event has date and time, calculate timestamp and POST to server
    if(!event.date || !event.time) return; // no time, don't send reminder
    try{
      // Get subscriptionId from localStorage
      const subscriptionId = localStorage.getItem('tmr_push_sub_id');
      if(!subscriptionId) {
        console.warn('[calendar] No subscription ID available - event reminder will not be delivered');
        return;
      }
      
      const [y, mo, d] = event.date.split('-').map(Number);
      const [hh, mm] = event.time.split(':').map(Number);
      if(!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return;
      const ts = new Date(y, mo-1, d, hh||0, mm||0).getTime();
      const accountId = getCurrentUserId();
      const payload = { subscriptionId: Number(subscriptionId), userId: accountId || null, title: 'Event: ' + (event.title||''), body: event.notes || event.title || '', deliverAt: ts };
      await serverFetch('/reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      console.debug('[calendar] posted event reminder to server', event.id);
    }catch(err){
      console.warn('[calendar] failed to post event reminder to server', err);
    }
  }
  function addOrUpdateEvent(event){
    const events = loadEvents();
    const idx = events.findIndex(e => e.id === event.id);
    
    // Add/update modification timestamp
    event.lastModified = Date.now();

    // Stamp ownership when authenticated
    try {
      const uid = (window.AuthClient && typeof window.AuthClient.getUserId === 'function') ? window.AuthClient.getUserId() : null;
      if (uid) event.ownerUserId = uid;
    } catch (e) {}
    
    if(idx >= 0) events[idx] = event; else events.push(event);
    saveEvents(events);
    // Persist to server when signed in so events sync across devices.
    // (Server will also schedule account-wide reminders.)
    try{
      if(isAuthed() && !(event.googleEventId || event.syncedFromGoogle)){
        if(event.serverId != null){
          updateServerEvent(event.serverId, event).catch(()=>{});
        } else {
          createServerEventFromLocal(event).then((newId)=>{
            if(newId != null){
              const after = loadEvents();
              const ix = after.findIndex(e => e && e.id === event.id);
              if(ix >= 0){ after[ix].serverId = newId; saveEvents(after); }
              try{ window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id: event.id, synced: true } })); }catch(e){}
            }
          }).catch(()=>{});
        }
      } else {
        // Anonymous mode: best-effort reminder via subscription id.
        postEventReminderToServer(event);
      }
    }catch(e){}
    try{ window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id: event.id } })); }catch(e){}
  }
  function deleteEvent(id){
    const events = loadEvents();
    const eventToDelete = events.find(e => e.id === id);
    
    // If event has a googleEventId, sync deletion to Google Calendar
    if (eventToDelete && eventToDelete.googleEventId) {
      try {
        console.log('[calendar] Syncing deletion to Google Calendar');
        
        // Send delete request to server (don't wait for response)
        serverFetch('/sync/google-calendar/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ googleEventId: eventToDelete.googleEventId, tmrEventId: id })
        }).catch(err => console.warn('[calendar] Failed to sync deletion to Google Calendar:', err));
      } catch (err) {
        console.warn('[calendar] Error syncing deletion:', err);
      }
    }
    
    // If this event exists on the server (signed-in), delete it there too.
    try{
      if(eventToDelete && eventToDelete.serverId != null && isAuthed() && !(eventToDelete.googleEventId || eventToDelete.syncedFromGoogle)){
        deleteServerEvent(eventToDelete.serverId).catch(()=>{});
      }
    }catch(e){}

    const filtered = events.filter(e => e.id !== id);
    saveEvents(filtered);
    try{ window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id } })); }catch(e){}
  }

  // Expose Meibot event creator - called by meibot.js
  window.calendarAddOrUpdateEvent = function(event) {
    addOrUpdateEvent(event);
    // Trigger calendar re-render if it exists
    try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id: event.id } })); } catch(e) {}
  };

  // Expose Meibot todo creator - called by meibot.js
  window.calendarAddTodo = function(todoText, reminderDescription) {
    try {
      const todos = JSON.parse(localStorage.getItem('tmr_todos') || '[]');
      // Parse reminder description to Unix timestamp if provided
      let reminderAtTime = undefined;
      if (reminderDescription) {
        reminderAtTime = parseReminderDescription(reminderDescription);
      }
      const newTodo = {
        id: 'td_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        title: todoText,
        details: '',
        text: todoText, // for backward compatibility
        reminderAt: reminderAtTime
      };
      todos.unshift(newTodo);
      localStorage.setItem('tmr_todos', JSON.stringify(todos));
      // POST reminder to server for this todo if it has a time
      if (newTodo.reminderAt) {
        postTodoReminderToServer(newTodo);
      }
      // Notify listeners
      try { window.dispatchEvent(new CustomEvent('tmr:todos:changed', { detail: { count: todos.length } })); } catch(e) {}
    } catch (err) {
      console.error('[Calendar] Error adding todo:', err);
    }
  };

  // Delete a todo by matching text
  window.calendarDeleteTodo = function(todoText) {
    console.log('[Calendar] calendarDeleteTodo called with:', todoText);
    try {
      const todos = JSON.parse(localStorage.getItem('tmr_todos') || '[]');
      const initialCount = todos.length;
      console.log('[Calendar] Current todos:', initialCount);
      console.log('[Calendar] All todos:', todos);
      
      // Remove all todos that match the text (case-insensitive)
      const filtered = todos.filter(t => {
        const todoStr = t.text || t.title || '';
        const matches = todoStr.toLowerCase().includes(todoText.toLowerCase());
        if (matches) console.log('[Calendar] Removing todo:', t);
        return !matches;
      });
      
      console.log('[Calendar] Filtered to', filtered.length, 'todos (removed', initialCount - filtered.length, ')');
      
      if (filtered.length < initialCount) {
        localStorage.setItem('tmr_todos', JSON.stringify(filtered));
        console.log('[Calendar] Saved filtered todos to localStorage');
        
        // Force re-render
        try { window.dispatchEvent(new CustomEvent('tmr:todos:changed', { detail: { count: filtered.length } })); } catch(e) { console.error('Event dispatch error:', e); }
        
        // Additional force render if available
        if (window.renderTodos) {
          console.log('[Calendar] Calling renderTodos()');
          window.renderTodos();
        }
      } else {
        console.warn('[Calendar] No todos matched:', todoText);
      }
    } catch (err) {
      console.error('[Calendar] Error deleting todo:', err);
    }
  };

  // Delete an event by matching title
  window.calendarDeleteEvent = function(eventTitle) {
    console.log('[Calendar] calendarDeleteEvent called with:', eventTitle);
    try {
      const events = JSON.parse(localStorage.getItem('tmr_events') || '[]');
      const initialCount = events.length;
      console.log('[Calendar] Current events:', initialCount);
      console.log('[Calendar] All events:', events);
      
      // Remove all events that match the title (case-insensitive)
      const filtered = events.filter(e => {
        const eventStr = e.title || '';
        const matches = eventStr.toLowerCase().includes(eventTitle.toLowerCase());
        if (matches) console.log('[Calendar] Removing event:', e);
        return !matches;
      });
      
      console.log('[Calendar] Filtered to', filtered.length, 'events (removed', initialCount - filtered.length, ')');
      
      if (filtered.length < initialCount) {
        localStorage.setItem('tmr_events', JSON.stringify(filtered));
        console.log('[Calendar] Saved filtered events to localStorage');
        
        // Force re-render
        try { window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { deleted: initialCount - filtered.length } })); } catch(e) { console.error('Event dispatch error:', e); }
        
        // Additional force render if available
        if (window.renderCalendar) {
          console.log('[Calendar] Calling renderCalendar()');
          window.renderCalendar();
        }
      } else {
        console.warn('[Calendar] No events matched:', eventTitle);
      }
    } catch (err) {
      console.error('[Calendar] Error deleting event:', err);
    }
  };

  // Parse reminder description (e.g., "in 1 hour", "tomorrow at 9am", "at 3pm today") to Unix timestamp
  function parseReminderDescription(desc) {
    if (!desc || typeof desc !== 'string') return undefined;
    desc = desc.toLowerCase().trim();
    const now = new Date();
    let targetDate = new Date(now);
    
    // Handle "in X minutes/hours/days"
    const inMatch = desc.match(/in\s+(\d+)\s+(minute|hour|day)s?/);
    if (inMatch) {
      const amount = parseInt(inMatch[1]);
      const unit = inMatch[2];
      if (unit === 'minute') targetDate.setMinutes(targetDate.getMinutes() + amount);
      else if (unit === 'hour') targetDate.setHours(targetDate.getHours() + amount);
      else if (unit === 'day') targetDate.setDate(targetDate.getDate() + amount);
      return targetDate.getTime();
    }
    
    // Handle "at HH:MM today/tonight"
    const atMatch = desc.match(/at\s+(\d{1,2}):(\d{2})\s*(am|pm)?\s*(today|tonight)?/);
    if (atMatch) {
      let hours = parseInt(atMatch[1]);
      const mins = parseInt(atMatch[2]);
      const ampm = atMatch[3];
      const dayRef = atMatch[4];
      
      if (ampm === 'pm' && hours !== 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      
      targetDate.setHours(hours, mins, 0, 0);
      
      // If it's in the past today, assume they meant tomorrow
      if (dayRef !== 'tomorrow' && targetDate.getTime() < now.getTime()) {
        targetDate.setDate(targetDate.getDate() + 1);
      }
      return targetDate.getTime();
    }
    
    // Handle "tomorrow at HH:MM"
    const tomorrowMatch = desc.match(/tomorrow\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/);
    if (tomorrowMatch) {
      let hours = parseInt(tomorrowMatch[1]);
      const mins = parseInt(tomorrowMatch[2]);
      const ampm = tomorrowMatch[3];
      
      if (ampm === 'pm' && hours !== 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      
      targetDate.setDate(targetDate.getDate() + 1);
      targetDate.setHours(hours, mins, 0, 0);
      return targetDate.getTime();
    }
    
    return undefined;
  }

  // Helper: post todo reminder to server
  async function postTodoReminderToServer(todo) {
    console.log('[calendar] postTodoReminderToServer called for:', todo.id, 'reminderAt:', todo.reminderAt);
    if (!todo.reminderAt) {
      console.log('[calendar] no reminderAt, skipping');
      return;
    }
    try {
      // Get subscriptionId from localStorage
      const subscriptionId = localStorage.getItem('tmr_push_sub_id');
      if(!subscriptionId) {
        console.warn('[calendar] No subscription ID available - todo reminder will not be delivered');
        return;
      }
      
      const reminderAtNum = Number(todo.reminderAt);
      console.log('[calendar] reminderAt as number:', reminderAtNum);
      const payload = { subscriptionId: Number(subscriptionId), userId: null, title: 'To-do: ' + (todo.text || ''), body: todo.text || '', deliverAt: reminderAtNum };
      console.log('[calendar] posting todo reminder with payload:', payload);
      const res = await serverFetch('/reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      console.log('[calendar] posted todo reminder to server, response status:', res.status);
    } catch (err) {
      console.error('[calendar] failed to post todo reminder to server', err);
    }
  }

  // Expose Meibot event creator - called by meibot.js
  // Export / Import
  function exportEventsToFile(){
    const events = loadEvents();
    // include todos in the export so calendar and todos can be imported together
    let todos = [];
    try{ todos = JSON.parse(localStorage.getItem('tmr_todos') || '[]'); }catch(e){ todos = []; }
    const payload = { events: events, todos: todos };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const name = 'tmr-export-' + new Date().toISOString().slice(0,10) + '.json';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function importEventsFromArray(arrOrObj, mode = 'merge'){
    // Accept older-format array (events only) or new object { events: [], todos: [] }
    let eventsArr = [];
    let todosArr = null;
    if(Array.isArray(arrOrObj)){
      eventsArr = arrOrObj;
    } else if(arrOrObj && typeof arrOrObj === 'object'){
      eventsArr = Array.isArray(arrOrObj.events) ? arrOrObj.events : [];
      todosArr = Array.isArray(arrOrObj.todos) ? arrOrObj.todos : null;
    } else {
      throw new Error('Imported JSON must be an array or an object with { events, todos }');
    }

    const cleaned = eventsArr.map(item => ({
      id: item.id || ('evt_' + Date.now() + '_' + Math.random().toString(36).slice(2,8)),
      title: String(item.title || '(no title)'),
      date: String(item.date || ''),
      time: item.time || '',
      notes: item.notes || '',
      color: item.color || '#ff922b'
    })).filter(i => /^\d{4}-\d{2}-\d{2}$/.test(i.date));

    if(mode === 'replace'){
      saveEvents(cleaned);
    } else {
      const existing = loadEvents();
      const existingIds = new Set(existing.map(e => e.id));
      const merged = existing.slice();
      cleaned.forEach(item => {
        if(!existingIds.has(item.id)) merged.push(item);
        else {
          const duplicate = existing.find(e => e.date === item.date && e.title === item.title && e.time === item.time);
          if(!duplicate){ item.id = 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); merged.push(item); }
        }
      });
      saveEvents(merged);
    }

    // If todos were included, import them as well
    if(todosArr !== null){
      try{
        const cleanedTodos = todosArr.map(t => ({ id: t.id || ('td_' + Date.now() + '_' + Math.random().toString(36).slice(2,8)), text: String(t.text || ''), reminderAt: t.reminderAt || undefined })).filter(x => x.text && x.text.length > 0);
        if(mode === 'replace'){
          localStorage.setItem('tmr_todos', JSON.stringify(cleanedTodos));
          try{ window.dispatchEvent(new CustomEvent('tmr:todos:changed', { detail: { count: cleanedTodos.length } })); }catch(e){}
        } else {
          const existingTodos = (function(){ try{return JSON.parse(localStorage.getItem('tmr_todos') || '[]'); }catch(e){return []; }})();
          const existingIds = new Set(existingTodos.map(t => t.id));
          const mergedTodos = existingTodos.slice();
          cleanedTodos.forEach(t => { if(!existingIds.has(t.id)) mergedTodos.push(t); });
          localStorage.setItem('tmr_todos', JSON.stringify(mergedTodos));
          try{ window.dispatchEvent(new CustomEvent('tmr:todos:changed', { detail: { count: mergedTodos.length } })); }catch(e){}
        }
      }catch(e){ /* ignore todos import errors */ }
    }
  }

  function importEventsFromFileObj(file, mode = 'merge'){
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const imported = JSON.parse(reader.result);
        importEventsFromArray(imported, mode);
        renderCalendar();
        // notify todo listeners in case todos were included
        try{ window.dispatchEvent(new CustomEvent('tmr:imports:done', { detail: {} })); }catch(e){}
        alert('Import successful');
      }catch(err){ alert('Import failed: invalid JSON'); }
    };
    reader.readAsText(file);
  }

  // DOM refs
  const calendarEl = document.getElementById('calendar');
  const monthYearEl = document.getElementById('month-year');
  const prevBtn = document.getElementById('prev-month');
  const nextBtn = document.getElementById('next-month');
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFileInput = document.getElementById('import-file');

  // Modal refs
  const modal = document.getElementById('event-modal');
  const closeModalBtn = document.getElementById('close-modal');
  const eventForm = document.getElementById('event-form');
  const titleInput = document.getElementById('event-title');
  const dateInput = document.getElementById('event-date');
  const timeInput = document.getElementById('event-time');
  const notesInput = document.getElementById('event-notes');
  const idInput = document.getElementById('event-id');
  const deleteBtn = document.getElementById('delete-event');
  const cancelBtn = document.getElementById('cancel-event');
  let selectedEventColor = '#ff922b'; // Default color (orange)
  const dayEventsList = document.createElement('div'); dayEventsList.className = 'modal-events';

  if(!calendarEl) return; // no calendar on page

  // Only apply accent color on load (picker and dropdown logic handled by TMR.js)
  const ACCENT_KEY = 'tmr_accent';
  function hexToRgb(hex){
    const h = hex.replace('#','');
    return h.length === 3 ? h.split('').map(c => parseInt(c+c,16)) : [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function rgbToHex(r,g,b){
    return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
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
  function isValidHexAccent(value) {
    if (typeof value !== 'string') return false;
    const v = value.trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
  }
  function normalizeHex(value) {
    const v = String(value || '').trim();
    if (!isValidHexAccent(v)) return '';
    if (v.length === 4) {
      return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    return v;
  }
  function tryComputeRgbFromCssColor(color) {
    try {
      const probe = document.createElement('span');
      probe.style.color = color;
      probe.style.display = 'none';
      document.documentElement.appendChild(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      const m = computed && computed.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      return m ? (m[1] + ',' + m[2] + ',' + m[3]) : '';
    } catch (_) {
      return '';
    }
  }
  function applyAccent(color){
    if(!color) return;
    const root = document.documentElement;

    // Respect existing pre-paint accent; only set when we have an explicit value.
    root.style.setProperty('--accent-color', color);

    // Derived vars are only computed for hex accents.
    const hex = normalizeHex(color);
    if (hex) {
      root.style.setProperty('--accent-hover', darkenHex(hex,18));
      const rgb = hexToRgbArr(hex);
      root.style.setProperty('--accent-rgb', rgb.join(','));
    } else {
      // If accent-rgb is missing, try to compute it from the CSS color.
      const existingRgb = (root.style.getPropertyValue('--accent-rgb') || '').trim();
      if (!existingRgb && typeof getComputedStyle === 'function') {
        const rgbStr = tryComputeRgbFromCssColor(color);
        if (rgbStr) root.style.setProperty('--accent-rgb', rgbStr);
      }
    }
  }

  function getInitialAccent() {
    const root = document.documentElement;
    const inline = (root && root.style ? root.style.getPropertyValue('--accent-color') : '') || '';
    if (inline.trim()) return inline.trim();

    // Try the global boot snapshot (unscoped).
    try {
      const raw = localStorage.getItem('tmr_boot_theme');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.accentColor === 'string' && parsed.accentColor.trim()) {
          return parsed.accentColor.trim();
        }
      }
    } catch (_) {}

    // Prefer the theme system key, then legacy accent key.
    try {
      const themeAccent = localStorage.getItem('theme_accent_color');
      if (themeAccent && String(themeAccent).trim()) return String(themeAccent).trim();
    } catch (_) {}

    try {
      const legacy = localStorage.getItem(ACCENT_KEY);
      if (legacy && String(legacy).trim()) return String(legacy).trim();
    } catch (_) {}

    return '';
  }

  // Apply accent only if we have one (avoid forcing default blue during startup).
  const initialAccent = getInitialAccent();
  if (initialAccent) applyAccent(initialAccent);

  // State
  let viewDate = new Date(); // current month view (uses local timezone for month/year)
  let activeDate = null; // currently opened date string

  function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
  function endOfMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0); }

  function formatMonthYear(d){
    return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }

  function pad(n){ return n < 10 ? '0'+n : String(n); }
  function ymd(dateObj){
    return dateObj.getFullYear() + '-' + pad(dateObj.getMonth()+1) + '-' + pad(dateObj.getDate());
  }

  function clearChildren(el){ while(el.firstChild) el.removeChild(el.firstChild); }

  function renderCalendar(){
    clearChildren(calendarEl);
    const first = startOfMonth(viewDate);
    const last = endOfMonth(viewDate);
    const startWeekday = first.getDay(); // 0=Sun
    const totalDays = last.getDate();

    monthYearEl.textContent = formatMonthYear(viewDate);

    // weekday headings (render into the separate weekday-row so they stay fixed)
    const weekdayRow = document.getElementById('weekday-row');
    if(weekdayRow){
      weekdayRow.innerHTML = ''; // clear
      const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      weekdays.forEach(w => {
        const head = document.createElement('div');
        head.className = 'calendar-weekday';
        head.textContent = w;
        weekdayRow.appendChild(head);
      });
    }

    // blank cells before month start
    for(let i=0;i<startWeekday;i++){
      const cell = document.createElement('div'); cell.className = 'calendar-cell'; cell.dataset.empty = 'true'; calendarEl.appendChild(cell);
    }

    for(let day=1; day<= totalDays; day++){
      const d = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
      const dateStr = ymd(d);

      // grid cell wrapper
      const cell = document.createElement('div'); cell.className = 'calendar-cell';

      // interactive button styled like other tmr buttons
      const btn = document.createElement('button');
      btn.className = 'calendar-day tmr-btn';
      btn.type = 'button';
      btn.setAttribute('data-date', dateStr);
      btn.title = 'Add or edit events for ' + dateStr;
      
      // Check if this is today
      const today = new Date();
      const todayStr = ymd(today);
      if (dateStr === todayStr) {
          btn.classList.add('today');
      }

      const dayNum = document.createElement('div'); dayNum.className = 'day-number'; dayNum.textContent = day;
      btn.appendChild(dayNum);

      const evs = eventsForDate(dateStr);
      const eventsWrap = document.createElement('div'); eventsWrap.className = 'cell-events';
      evs.slice(0,4).forEach(ev => {
        const dot = document.createElement('span'); dot.className = 'event-dot';
        dot.title = ev.title;
        dot.style.background = ev.color || '#ff922b';
        eventsWrap.appendChild(dot);
      });
      if(evs.length > 4){
        const more = document.createElement('span'); more.textContent = '+' + (evs.length - 4);
        more.style.fontSize = '12px'; more.style.marginLeft = '6px'; eventsWrap.appendChild(more);
      }
      btn.appendChild(eventsWrap);

      // Click to open modal to add/edit
      btn.addEventListener('click', () => openModalForDate(dateStr));
      btn.addEventListener('keydown', (e) => { if(e.key === 'Enter') openModalForDate(dateStr); });

      cell.appendChild(btn);
      calendarEl.appendChild(cell);
    }
  }

  function openModalForDate(dateStr){
    activeDate = dateStr;
    // populate event list
    const evs = eventsForDate(dateStr);
    clearChildren(dayEventsList);
    if(evs.length === 0){
      // No events - just leave empty
    } else {
      evs.forEach(ev => {
        const item = document.createElement('div'); item.className = 'modal-event-item';
        const left = document.createElement('div'); left.textContent = (ev.time ? (ev.time + ' — ') : '') + ev.title;
        const right = document.createElement('div');
        const editBtn = document.createElement('button'); editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', (e)=>{ e.stopPropagation(); fillFormForEvent(ev); });
        right.appendChild(editBtn);
        item.appendChild(left); item.appendChild(right);
        dayEventsList.appendChild(item);
      });
    }

    // insert the list above the form
    const modalContent = modal.querySelector('.modal-content');
    const existingList = modalContent.querySelector('.modal-events');
    if(!existingList) modalContent.insertBefore(dayEventsList, eventForm);

    modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false');
    idInput.value = '';
    titleInput.value = '';
    dateInput.value = dateStr;
    timeInput.value = '';
    notesInput.value = '';
    deleteBtn.style.display = 'none';
    
    // Reset color to default for new event
    selectedEventColor = '#ff922b';
    colorBtns.forEach(b => b.style.borderWidth = '2px');
    const defaultBtn = document.querySelector(`.color-btn[data-color="#ff922b"]`);
    if(defaultBtn) {
      defaultBtn.style.borderWidth = '3px';
      defaultBtn.style.borderColor = '#333';
    }
    
    document.getElementById('modal-title').textContent = 'Events for ' + dateStr;
  }

  function fillFormForEvent(ev){
    idInput.value = ev.id;
    titleInput.value = ev.title || '';
    dateInput.value = ev.date || activeDate;
    timeInput.value = ev.time || '';
    notesInput.value = ev.notes || '';
    
    // Restore color when editing event
    if(ev.color) {
      selectedEventColor = ev.color;
      // Highlight the matching color button
      const matchingBtn = document.querySelector(`.color-btn[data-color="${ev.color}"]`);
      if(matchingBtn) {
        colorBtns.forEach(b => b.style.borderWidth = '2px');
        matchingBtn.style.borderWidth = '3px';
        matchingBtn.style.borderColor = '#333';
      }
    } else {
      // Reset to default if no color
      selectedEventColor = '#ff922b';
      colorBtns.forEach(b => b.style.borderWidth = '2px');
    }
    
    deleteBtn.style.display = '';
    document.getElementById('modal-title').textContent = 'Edit Event';
  }

  // Export functions to window for external use (e.g., search navigation)
  window.openModalForDate = openModalForDate;
  window.fillFormForEvent = fillFormForEvent;

  function closeModal(){ modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); activeDate = null; }

  function triggerMonthTransition() {
    // Add animation class, render calendar, then remove class
    calendarEl.classList.add('month-transition');
    renderCalendar();
    // Remove class after animation completes
    setTimeout(() => {
      calendarEl.classList.remove('month-transition');
    }, 350);
  }

  // wire events
  prevBtn.addEventListener('click', ()=>{ 
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth()-1, 1); 
    triggerMonthTransition();
  });
  nextBtn.addEventListener('click', ()=>{ 
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 1); 
    triggerMonthTransition();
  });
  closeModalBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  exportBtn && exportBtn.addEventListener('click', ()=> exportEventsToFile());
  importBtn && importBtn.addEventListener('click', ()=> importFileInput.click());
  importFileInput && importFileInput.addEventListener('change', (e)=>{
    const f = e.target.files[0]; if(!f) return; const mode = confirm('Replace existing events with imported data? OK = Replace, Cancel = Merge') ? 'replace' : 'merge'; importEventsFromFileObj(f, mode);
    importFileInput.value = '';
  });

  eventForm.addEventListener('submit', (ev)=>{
    ev.preventDefault();
    const idVal = idInput.value || generateId();
    const item = {
      id: idVal,
      title: titleInput.value.trim() || '(no title)',
      date: dateInput.value,
      time: timeInput.value || '',
      notes: notesInput.value || '',
      color: selectedEventColor
    };
    addOrUpdateEvent(item);
    closeModal(); renderCalendar();
  });

  // Color picker button handlers
  const colorBtns = document.querySelectorAll('.color-btn');
  colorBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      selectedEventColor = btn.dataset.color;
      // Visual feedback: highlight selected color
      colorBtns.forEach(b => b.style.borderWidth = '2px');
      btn.style.borderWidth = '3px';
      btn.style.borderColor = '#333';
    });
  });

  deleteBtn.addEventListener('click', ()=>{
    const idVal = idInput.value; if(!idVal) return; if(!confirm('Delete this event?')) return; deleteEvent(idVal); closeModal(); renderCalendar();
  });

  // Esc to close modal
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal(); });

  // initial render
  renderCalendar();

  // Best-effort: pull latest server events (multi-device sync)
  // and re-render if anything changes.
  try{
    syncEventsFromServerIfAuthed().then((did)=>{
      if(did) try{ window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { synced: true } })); }catch(e){}
    }).catch(()=>{});
  }catch(e){}

  // Refresh on focus so edits from another device show up quickly.
  window.addEventListener('focus', ()=>{
    try{
      syncEventsFromServerIfAuthed().then((did)=>{
        if(did) try{ window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { synced: true } })); }catch(e){}
      }).catch(()=>{});
    }catch(e){}
  });

  // Light periodic refresh while open.
  setInterval(()=>{
    try{ syncEventsFromServerIfAuthed().then((did)=>{ if(did) try{ window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { synced: true } })); }catch(e){} }).catch(()=>{}); }catch(e){}
  }, 60000);

  // Listen for event changes (from Meibot or other sources)
  window.addEventListener('tmr:events:changed', () => {
    renderCalendar();
  });

  // When auth changes/restores, re-render from the correct user-scoped storage.
  window.addEventListener('tmr:auth-changed', () => {
    try{
      syncEventsFromServerIfAuthed().then(()=>{ renderCalendar(); }).catch(()=>{ renderCalendar(); });
    }catch(e){ renderCalendar(); }
  });

  };

  const __tmrStart = () => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', __tmrCalendarInit, { once: true });
    } else {
      __tmrCalendarInit();
    }
  };

  if (typeof window !== 'undefined' && window.AuthClient && window.AuthClient.ready && typeof window.AuthClient.ready.then === 'function') {
    window.AuthClient.ready.then(__tmrStart).catch(__tmrStart);
  } else {
    __tmrStart();
  }

})();

/* To-do app: saves to localStorage (key: tmr_todos)
   Features: title + detailed notes with formatting (checkboxes, bullets, numbering)
   Modal editor for viewing/editing todo details
*/
(function(){
  const __tmrTodoInit = () => {
  const TODO_KEY = 'tmr_todos';
  const createBtn = document.getElementById('create-todo-btn');
  const listEl = document.getElementById('todo-list');
  if(!createBtn || !listEl) return;

  // Create todo modal
  const modal = document.createElement('div');
  modal.id = 'todo-modal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Todo</h3>
        <button id="close-todo-modal" class="close-btn">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group" id="todo-title-group">
          <label for="todo-title-input">Title:</label>
          <input type="text" id="todo-title-input" placeholder="Todo title">
        </div>
        <div class="form-group" id="todo-details-group">
          <label for="todo-details-input">Details:</label>
          <div class="formatting-toolbar" id="formatting-toolbar" style="display: none;">
            <button id="btn-checkbox" class="format-btn" title="Add checkbox">☐ Checkbox</button>
            <button id="btn-bullet" class="format-btn" title="Add bullet">• Bullet</button>
            <button id="btn-number" class="format-btn" title="Add number">1. Number</button>
          </div>
          <textarea id="todo-details-input" placeholder="Add details here. Use formatting buttons or type:&#10;☐ for checkbox&#10;• for bullet&#10;1. for numbered"></textarea>
        </div>
        <div class="form-group preview" id="preview-group" style="display: none;">
          <label>Preview:</label>
          <div id="todo-preview"></div>
        </div>
        <div class="form-group" id="todo-display-group" style="display: none;">
          <div id="todo-display"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button id="edit-todo-btn" class="small-tmr-btn" style="display: none;">Edit</button>
        <button id="save-todo-btn" class="small-tmr-btn" style="display: none;">Save</button>
        <button id="cancel-todo-btn" class="small-tmr-btn" style="display: none;">Cancel</button>
        <button id="close-todo-btn" class="small-tmr-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeBtn = document.getElementById('close-todo-modal');
  const editBtn = document.getElementById('edit-todo-btn');
  const saveTodoBtn = document.getElementById('save-todo-btn');
  const cancelBtn = document.getElementById('cancel-todo-btn');
  const closeViewBtn = document.getElementById('close-todo-btn');
  const titleInput = document.getElementById('todo-title-input');
  const detailsInput = document.getElementById('todo-details-input');
  const preview = document.getElementById('todo-preview');
  const formattingToolbar = document.getElementById('formatting-toolbar');
  const titleGroup = document.getElementById('todo-title-group');
  const detailsGroup = document.getElementById('todo-details-group');
  const previewGroup = document.getElementById('preview-group');
  const displayGroup = document.getElementById('todo-display-group');
  const todoDisplay = document.getElementById('todo-display');
  
  let currentTodoId = null;
  let isEditMode = false;

  function loadTodos(){ try{ return JSON.parse(localStorage.getItem(TODO_KEY) || '[]'); }catch(e){ return []; } }
  function saveTodos(todos){ localStorage.setItem(TODO_KEY, JSON.stringify(todos));
    try{ window.dispatchEvent(new CustomEvent('tmr:todos:changed', { detail: { count: (Array.isArray(todos) ? todos.length : loadTodos().length) } })); }catch(e){}
  }
  function generateId(){ return 'td_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

  function formatDetailsToHtml(text) {
    if (!text) return '';
    let html = '';
    const lines = text.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('☐')) {
        html += `<div class="todo-line"><input type="checkbox" disabled> ${trimmed.substring(1).trim()}</div>`;
      } else if (trimmed.startsWith('•')) {
        html += `<div class="todo-line">• ${trimmed.substring(1).trim()}</div>`;
      } else if (trimmed.match(/^\d+\./)) {
        html += `<div class="todo-line">${trimmed}</div>`;
      } else if (trimmed) {
        html += `<div class="todo-line">${trimmed}</div>`;
      }
    });
    return html || '<p style="opacity: 0.6;">No details</p>';
  }

  function openTodoModal(todoId) {
    currentTodoId = todoId;
    const todos = loadTodos();
    const todo = todos.find(t => t.id === todoId);

    if (todo) {
      isEditMode = false;
      // Show view mode
      titleGroup.style.display = 'none';
      detailsGroup.style.display = 'none';
      previewGroup.style.display = 'none';
      displayGroup.style.display = 'block';
      
      // Display todo content
      const titleDiv = document.createElement('div');
      titleDiv.style.cssText = 'font-weight: bold; font-size: 1.1em; margin-bottom: 12px; color: #333;';
      titleDiv.textContent = todo.title || todo.text || '(Untitled)';
      
      const detailsDiv = document.createElement('div');
      detailsDiv.innerHTML = formatDetailsToHtml(todo.details || '');
      
      todoDisplay.innerHTML = '';
      todoDisplay.appendChild(titleDiv);
      if (todo.details) {
        todoDisplay.appendChild(detailsDiv);
      }
      
      // Show edit button and close button, hide edit controls
      editBtn.style.display = 'block';
      saveTodoBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
      closeViewBtn.style.display = 'block';
      
      modal.classList.remove('hidden');
    }
  }

  function openTodoModalForCreation() {
    currentTodoId = null;
    isEditMode = true;
    titleInput.value = '';
    detailsInput.value = '';
    updatePreview();
    
    // Show edit mode
    titleGroup.style.display = 'block';
    detailsGroup.style.display = 'block';
    previewGroup.style.display = 'block';
    displayGroup.style.display = 'none';
    formattingToolbar.style.display = 'flex';
    
    // Hide view button, show save/cancel
    editBtn.style.display = 'none';
    saveTodoBtn.style.display = 'block';
    cancelBtn.style.display = 'block';
    closeViewBtn.style.display = 'none';
    
    modal.classList.remove('hidden');
    titleInput.focus();
  }

  function enterEditMode() {
    isEditMode = true;
    const todos = loadTodos();
    const todo = todos.find(t => t.id === currentTodoId);
    
    if (todo) {
      titleInput.value = todo.title || todo.text || '';
      detailsInput.value = todo.details || '';
      updatePreview();
      
      // Show edit mode
      titleGroup.style.display = 'block';
      detailsGroup.style.display = 'block';
      previewGroup.style.display = 'block';
      displayGroup.style.display = 'none';
      formattingToolbar.style.display = 'flex';
      
      // Switch buttons
      editBtn.style.display = 'none';
      saveTodoBtn.style.display = 'block';
      cancelBtn.style.display = 'block';
      closeViewBtn.style.display = 'none';
      
      titleInput.focus();
    }
  }

  function closeModal() {
    modal.classList.add('hidden');
    currentTodoId = null;
    isEditMode = false;
  }

  function updatePreview() {
    preview.innerHTML = formatDetailsToHtml(detailsInput.value);
  }

  function saveTodo() {
    const title = titleInput.value.trim() || '(Untitled)';
    const details = detailsInput.value.trim();
    
    if (!title && !details) return;

    const todos = loadTodos();
    
    if (currentTodoId) {
      // Update existing
      const idx = todos.findIndex(t => t.id === currentTodoId);
      if (idx >= 0) {
        todos[idx] = { id: currentTodoId, title, details, text: title }; // Keep text for backward compatibility
      }
    } else {
      // Create new
      const newTodo = { id: generateId(), title, details, text: title };
      todos.unshift(newTodo);
    }
    
    saveTodos(todos);
    closeModal();
    render();
    renderMenu();
  }

  function render(){
    const todos = loadTodos();
    listEl.innerHTML = '';
    todos.forEach(t => {
      const li = document.createElement('li'); 
      li.className = 'todo-item'; 
      li.dataset.id = t.id;

      const cb = document.createElement('input'); 
      cb.type = 'checkbox'; 
      cb.className = 'todo-check';
      cb.checked = t.completed || false;
      cb.addEventListener('change', ()=>{ 
        const todos = loadTodos();
        const idx = todos.findIndex(x => x.id === t.id);
        if (idx >= 0) {
          todos[idx].completed = cb.checked;
          saveTodos(todos);
          render();
        }
      });

      const textWrap = document.createElement('div'); 
      textWrap.className = 'todo-text';
      textWrap.style.cursor = 'pointer';
      
      const titleSpan = document.createElement('span');
      titleSpan.className = 'todo-title';
      titleSpan.textContent = t.title || t.text || '(Untitled)';
      titleSpan.style.fontWeight = 'bold';
      titleSpan.addEventListener('click', () => openTodoModal(t.id));
      
      const actions = document.createElement('div'); 
      actions.className = 'todo-actions';
      
      const delBtn = document.createElement('button'); 
      delBtn.className='small-tmr-btn'; 
      delBtn.textContent = 'Delete'; 
      delBtn.addEventListener('click', ()=>{ 
        if(!confirm('Delete this todo?')) return; 
        const remaining = loadTodos().filter(x=>x.id!==t.id); 
        saveTodos(remaining); 
        render(); 
      });
      
      actions.appendChild(delBtn);

      textWrap.appendChild(titleSpan);
      
      li.appendChild(cb); 
      li.appendChild(textWrap); 
      li.appendChild(actions);
      listEl.appendChild(li);
    });
  }

  // Format button handlers
  document.getElementById('btn-checkbox').addEventListener('click', () => {
    const start = detailsInput.selectionStart;
    const end = detailsInput.selectionEnd;
    const before = detailsInput.value.substring(0, start);
    const after = detailsInput.value.substring(end);
    detailsInput.value = before + '☐ ' + after;
    detailsInput.selectionStart = start + 2;
    detailsInput.focus();
    updatePreview();
  });

  document.getElementById('btn-bullet').addEventListener('click', () => {
    const start = detailsInput.selectionStart;
    const end = detailsInput.selectionEnd;
    const before = detailsInput.value.substring(0, start);
    const after = detailsInput.value.substring(end);
    detailsInput.value = before + '• ' + after;
    detailsInput.selectionStart = start + 2;
    detailsInput.focus();
    updatePreview();
  });

  document.getElementById('btn-number').addEventListener('click', () => {
    const start = detailsInput.selectionStart;
    const end = detailsInput.selectionEnd;
    const before = detailsInput.value.substring(0, start);
    const after = detailsInput.value.substring(end);
    detailsInput.value = before + '1. ' + after;
    detailsInput.selectionStart = start + 3;
    detailsInput.focus();
    updatePreview();
  });

  detailsInput.addEventListener('input', updatePreview);

  closeBtn.addEventListener('click', closeModal);
  editBtn.addEventListener('click', enterEditMode);
  cancelBtn.addEventListener('click', closeModal);
  closeViewBtn.addEventListener('click', closeModal);
  saveTodoBtn.addEventListener('click', saveTodo);

  // Create todo button
  createBtn.addEventListener('click', () => {
    openTodoModalForCreation();
  });

  // initial
  render();

  // Listen for todo changes (from Meibot or other sources)
  window.addEventListener('tmr:todos:changed', () => {
    render();
    renderMenu();
  });

  // Menu integration: optional compact todo list inside the TMR dropdown
  const menuToggle = document.getElementById('menu-todo-toggle');
  const menuList = document.getElementById('tmr-menu-todo-list');

  function renderMenu(){
    if(!menuList) return;
    const todos = loadTodos();
    menuList.innerHTML = '';
    if(todos.length === 0){
      const p = document.createElement('div'); p.textContent = 'No todos'; p.style.opacity = '0.8'; menuList.appendChild(p); return;
    }
    todos.forEach(t => {
      const li = document.createElement('div'); li.className = 'todo-item'; li.dataset.id = t.id;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'todo-check';
      cb.checked = t.completed || false;
      cb.addEventListener('change', ()=>{ 
        const todos = loadTodos();
        const idx = todos.findIndex(x=>x.id===t.id);
        if (idx >= 0) {
          todos[idx].completed = cb.checked;
          saveTodos(todos);
          render();
          renderMenu();
        }
      });
      const txt = document.createElement('div'); txt.className = 'todo-text'; 
      const titleSpan = document.createElement('span'); 
      titleSpan.className = 'todo-title';
      titleSpan.textContent = t.title || t.text || '(Untitled)'; 
      titleSpan.style.fontWeight = 'bold';
      titleSpan.style.cursor = 'pointer';
      titleSpan.addEventListener('click', () => openTodoModal(t.id));
      txt.appendChild(titleSpan);
      const actions = document.createElement('div'); actions.className = 'todo-actions';
      const delBtn = document.createElement('button'); delBtn.className='small-tmr-btn'; delBtn.textContent='Delete'; delBtn.addEventListener('click', ()=>{ if(!confirm('Delete this todo?')) return; const all = loadTodos(); const idx = all.findIndex(x=>x.id===t.id); if(idx>=0){ all.splice(idx,1); saveTodos(all); render(); renderMenu(); } });
      actions.appendChild(delBtn);
      li.appendChild(cb);
      li.appendChild(txt);
      li.appendChild(actions);
      menuList.appendChild(li);
    });
  }

  // wire menu toggle to show/hide main todo app and to render menu list
  if(menuToggle){
    menuToggle.addEventListener('click', ()=>{
      const todoApp = document.getElementById('todo-app');
      if(todoApp){
        const isHidden = getComputedStyle(todoApp).display === 'none';
        todoApp.style.display = isHidden ? 'block' : 'none';
        if(isHidden){ const inp = document.getElementById('todo-input'); if(inp) inp.focus(); }
      }
      // toggle menu list visibility
      if(menuList){ menuList.hidden = !menuList.hidden; renderMenu(); }
    });
    // ensure menu list reflects current todos when menu is opened elsewhere
    renderMenu();
    try{ window.dispatchEvent(new CustomEvent('tmr:todos:changed', { detail: { count: loadTodos().length } })); }catch(e){}
  }
  
  // Check hourly for day changes to update today styling
  setInterval(() => {
    renderCalendar();
  }, 3600000); // 1 hour in milliseconds

  };

  const __tmrStart = () => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', __tmrTodoInit, { once: true });
    } else {
      __tmrTodoInit();
    }
  };

  if (typeof window !== 'undefined' && window.AuthClient && window.AuthClient.ready && typeof window.AuthClient.ready.then === 'function') {
    window.AuthClient.ready.then(__tmrStart).catch(__tmrStart);
  } else {
    __tmrStart();
  }

})();
