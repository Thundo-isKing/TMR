/* Minimal calendar implementation using localStorage (key: tmr_events)
   Features: month grid, prev/next navigation, add/edit/delete events via modal.
   Event model: { id, title, date (YYYY-MM-DD), time, notes, color }
*/
/* eslint-disable no-undef */
(function(){
  const STORAGE_KEY = 'tmr_events';

  // Helper: serverFetch with fallbacks (mirrors TMR.js logic)
  async function serverFetch(path, opts={}){
    try{
      if(location.hostname.includes('ngrok')){
        const url = location.origin + path;
        try{
          const res = await fetch(url, opts);
          if(res.ok) return res;
        }catch(e){ console.debug('[calendar.serverFetch] ngrok fetch failed', e); }
      }
      try{
        const res = await fetch(path, opts);
        if(res.ok) return res;
      }catch(e){ /* try fallback */ }
      const url = 'http://localhost:3003' + path;
      const res = await fetch(url, opts);
      return res;
    }catch(e){
      console.warn('[calendar.serverFetch] all attempts failed', e);
      throw e;
    }
  }

  // Helpers
  function loadEvents(){
    try{ return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch(e){ return []; }
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
      const [y, mo, d] = event.date.split('-').map(Number);
      const [hh, mm] = event.time.split(':').map(Number);
      if(!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return;
      const ts = new Date(y, mo-1, d, hh||0, mm||0).getTime();
      const payload = { title: 'Event: ' + (event.title||''), body: event.notes || event.title || '', deliverAt: ts };
      await serverFetch('/reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      console.debug('[calendar] posted event reminder to server', event.id);
    }catch(err){
      console.warn('[calendar] failed to post event reminder to server', err);
    }
  }
  function addOrUpdateEvent(event){
    const events = loadEvents();
    const idx = events.findIndex(e => e.id === event.id);
    if(idx >= 0) events[idx] = event; else events.push(event);
    saveEvents(events);
    // POST reminder to server if event has date/time
    postEventReminderToServer(event);
    try{ window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id: event.id } })); }catch(e){}
  }
  function deleteEvent(id){
    const events = loadEvents().filter(e => e.id !== id);
    saveEvents(events);
    try{ window.dispatchEvent(new CustomEvent('tmr:events:changed', { detail: { id } })); }catch(e){}
  }

  // Expose Meibot event creator - called by meibot.js
  window.calendarAddOrUpdateEvent = function(event) {
    addOrUpdateEvent(event);
    // Trigger calendar re-render if it exists
    try { window.dispatchEvent(new CustomEvent('tmr:calendar:needsRender')); } catch(e) {}
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
        text: todoText,
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
      const reminderAtNum = Number(todo.reminderAt);
      console.log('[calendar] reminderAt as number:', reminderAtNum);
      const payload = { title: 'To-do: ' + (todo.text || ''), body: todo.text || '', deliverAt: reminderAtNum };
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
      color: item.color || '#f19100'
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
  function applyAccent(hex){
    if(!hex) return;
    const root = document.documentElement;
    root.style.setProperty('--accent-color', hex);
    root.style.setProperty('--accent-hover', darkenHex(hex,18));
    // Also set --accent-rgb for backgrounds.css
    const rgb = hexToRgbArr(hex);
    root.style.setProperty('--accent-rgb', rgb.join(','));
  }
  // apply saved accent on load
  const savedAccent = localStorage.getItem(ACCENT_KEY) || '#0089f1';
  applyAccent(savedAccent);

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
        const head = document.createElement('div'); head.className = 'calendar-cell';
        head.style.background = 'transparent'; head.style.minHeight = 'auto'; head.style.padding = '6px';
        head.style.fontWeight = '700'; head.style.textAlign = 'center'; head.textContent = w; weekdayRow.appendChild(head);
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

      const dayNum = document.createElement('div'); dayNum.className = 'day-number'; dayNum.textContent = day;
      btn.appendChild(dayNum);

      const evs = eventsForDate(dateStr);
      const eventsWrap = document.createElement('div'); eventsWrap.className = 'cell-events';
      evs.slice(0,4).forEach(ev => {
        const dot = document.createElement('span'); dot.className = 'event-dot';
        dot.title = ev.title;
        dot.style.background = ev.color || '#f19100';
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
      const hint = document.createElement('div'); hint.textContent = 'No events for this day.'; hint.style.marginBottom = '8px';
      dayEventsList.appendChild(hint);
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
    document.getElementById('modal-title').textContent = 'Events for ' + dateStr;
  }

  function fillFormForEvent(ev){
    idInput.value = ev.id;
    titleInput.value = ev.title || '';
    dateInput.value = ev.date || activeDate;
    timeInput.value = ev.time || '';
    notesInput.value = ev.notes || '';
    deleteBtn.style.display = '';
    document.getElementById('modal-title').textContent = 'Edit Event';
  }

  function closeModal(){ modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); activeDate = null; }

  // wire events
  prevBtn.addEventListener('click', ()=>{ viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth()-1, 1); renderCalendar(); });
  nextBtn.addEventListener('click', ()=>{ viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 1); renderCalendar(); });
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
      color: '#f19100'
    };
    addOrUpdateEvent(item);
    closeModal(); renderCalendar();
  });

  deleteBtn.addEventListener('click', ()=>{
    const idVal = idInput.value; if(!idVal) return; if(!confirm('Delete this event?')) return; deleteEvent(idVal); closeModal(); renderCalendar();
  });

  // Esc to close modal
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal(); });

  // initial render
  renderCalendar();

})();

/* To-do app: saves to localStorage (key: tmr_todos)
   Features: add, edit, delete by checking checkbox (immediate deletion), persists in browser
*/
(function(){
  const TODO_KEY = 'tmr_todos';
  const input = document.getElementById('todo-input');
  const addBtn = document.getElementById('add-todo');
  const listEl = document.getElementById('todo-list');
  if(!input || !addBtn || !listEl) return;

  function loadTodos(){ try{ return JSON.parse(localStorage.getItem(TODO_KEY) || '[]'); }catch(e){ return []; } }
  function saveTodos(todos){ localStorage.setItem(TODO_KEY, JSON.stringify(todos));
    try{ window.dispatchEvent(new CustomEvent('tmr:todos:changed', { detail: { count: (Array.isArray(todos) ? todos.length : loadTodos().length) } })); }catch(e){}
  }
  function generateId(){ return 'td_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

  function render(){
    const todos = loadTodos();
    listEl.innerHTML = '';
    todos.forEach(t => {
      const li = document.createElement('li'); li.className = 'todo-item'; li.dataset.id = t.id;

      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'todo-check';
      cb.addEventListener('change', ()=>{ if(cb.checked){ // delete when checked
        const remaining = loadTodos().filter(x => x.id !== t.id); saveTodos(remaining); render(); }
      });

      const textWrap = document.createElement('div'); textWrap.className = 'todo-text';
      const span = document.createElement('span'); span.textContent = t.text; span.tabIndex = 0;
      span.addEventListener('dblclick', ()=> startEdit());
      span.addEventListener('keydown', (e)=>{ if(e.key==='Enter') startEdit(); });

      function startEdit(){
        const inputEl = document.createElement('input'); inputEl.type = 'text'; inputEl.value = t.text;
        inputEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter') finishEdit(); if(e.key==='Escape') render(); });
        function finishEdit(){ const v = inputEl.value.trim(); if(v){ t.text = v; const all = loadTodos(); const idx = all.findIndex(x=>x.id===t.id); if(idx>=0) { all[idx]=t; saveTodos(all); } render(); } else { render(); } }
        const saveBtn = document.createElement('button'); saveBtn.className='small-tmr-btn'; saveBtn.textContent='Save'; saveBtn.addEventListener('click', finishEdit);
        const cancelBtn = document.createElement('button'); cancelBtn.className='small-tmr-btn'; cancelBtn.textContent='Cancel'; cancelBtn.addEventListener('click', render);
        textWrap.innerHTML = ''; textWrap.appendChild(inputEl); textWrap.appendChild(saveBtn); textWrap.appendChild(cancelBtn); inputEl.focus();
      }

      const actions = document.createElement('div'); actions.className = 'todo-actions';
      const editBtn = document.createElement('button'); editBtn.className='small-tmr-btn'; editBtn.textContent = 'Edit'; editBtn.addEventListener('click', startEdit);
      const delBtn = document.createElement('button'); delBtn.className='small-tmr-btn'; delBtn.textContent = 'Delete'; delBtn.addEventListener('click', ()=>{ if(!confirm('Delete this todo?')) return; const remaining = loadTodos().filter(x=>x.id!==t.id); saveTodos(remaining); render(); });
      actions.appendChild(editBtn); actions.appendChild(delBtn);

      textWrap.appendChild(span);
      li.appendChild(cb); li.appendChild(textWrap); li.appendChild(actions);
      listEl.appendChild(li);
    });
  }

  addBtn.addEventListener('click', ()=>{ const v = input.value.trim(); if(!v) return; const todos = loadTodos(); const item = { id: generateId(), text: v }; todos.unshift(item); saveTodos(todos); input.value = ''; render(); });
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ addBtn.click(); } });

  // initial
  render();

  // Menu integration: optional compact todo list inside the TMR dropdown
  const menuToggle = document.getElementById('menu-todo-toggle');
  const menuList = document.getElementById('tmr-menu-todo-list');

  function renderMenu(){
    if(!menuList) return;
    // toggle hidden attribute depending on if there are todos
    const todos = loadTodos();
    menuList.innerHTML = '';
    if(todos.length === 0){
      const p = document.createElement('div'); p.textContent = 'No todos'; p.style.opacity = '0.8'; menuList.appendChild(p); return;
    }
    todos.forEach(t => {
      const li = document.createElement('div'); li.className = 'todo-item'; li.dataset.id = t.id;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'todo-check';
      cb.addEventListener('change', ()=>{ if(cb.checked){ const remaining = loadTodos().filter(x=>x.id!==t.id); saveTodos(remaining); render(); renderMenu(); } });
      const txt = document.createElement('div'); txt.className = 'todo-text'; const span = document.createElement('span'); span.textContent = t.text; txt.appendChild(span);
      const actions = document.createElement('div'); actions.className = 'todo-actions';
      const editBtn = document.createElement('button'); editBtn.className='small-tmr-btn'; editBtn.textContent='Edit'; editBtn.addEventListener('click', ()=>{
        const v = prompt('Edit todo', t.text); if(v === null) return; const nv = v.trim(); if(!nv) return; const all = loadTodos(); const idx = all.findIndex(x=>x.id===t.id); if(idx>=0){ all[idx].text = nv; saveTodos(all); render(); renderMenu(); }
      });
      const delBtn = document.createElement('button'); delBtn.className='small-tmr-btn'; delBtn.textContent='Delete'; delBtn.addEventListener('click', ()=>{ if(!confirm('Delete this todo?')) return; const remaining = loadTodos().filter(x=>x.id!==t.id); saveTodos(remaining); render(); renderMenu(); });
      actions.appendChild(editBtn); actions.appendChild(delBtn);
      li.appendChild(cb); li.appendChild(txt); li.appendChild(actions); menuList.appendChild(li);
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

})();
