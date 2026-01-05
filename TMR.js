
// Wrap localStorage to use per-user keys via AuthClient.
// Important: do NOT call AuthClient.storage from inside this proxy (would recurse).
const originalLocalStorage = window.localStorage;
window.__tmrOriginalLocalStorage = originalLocalStorage;

// NOTE: auth-client.js installs a robust key-scoping patch for localStorage.
// Avoid installing a Proxy (some browsers disallow replacing window.localStorage,
// and if it does work it can double-scope keys).
try {
    if (!window.__tmrScopedLocalStorageInstalled && typeof AuthClient !== 'undefined' && AuthClient && typeof AuthClient.getCacheKey === 'function') {
        const toUserKey = (key) => AuthClient.getCacheKey(String(key));

        window.localStorage = new Proxy(originalLocalStorage, {
            get(target, prop) {
                if (prop === 'getItem') return (key) => target.getItem(toUserKey(key));
                if (prop === 'setItem') return (key, val) => target.setItem(toUserKey(key), val);
                if (prop === 'removeItem') return (key) => target.removeItem(toUserKey(key));
                if (prop === 'clear') return () => target.clear();
                if (prop === 'length') return target.length;
                if (prop === 'key') return (idx) => target.key(idx);
                return target[prop];
            },
            set(target, prop, val) {
                target[prop] = val;
                return true;
            }
        });
    }
} catch (e) {
    // Ignore: safest fallback is to use native localStorage (auth-client will patch methods).
}

const displayClock = () => {
    const now = new Date();
    let hrs = now.getHours();
    const ampm = hrs >= 12 ? 'PM' : 'AM';
    hrs = hrs % 12;
    hrs = hrs ? hrs : 12; // convert 0 to 12
    const min = String(now.getMinutes()).padStart(2, '0');
    const sec = String(now.getSeconds()).padStart(2, '0');
    
    // Update header clock
    const headerClock = document.getElementById('header-clock');
    if (headerClock) {
        headerClock.textContent = `${hrs}:${min}:${sec} ${ampm}`;
    }
    
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

// Get current user ID for user-specific localStorage
let currentUserId = null;
async function initializeUserId() {
    try {
        const res = await fetch('/auth/verify');
        if (res.ok) {
            const data = await res.json();
            currentUserId = data.userId;
            console.log('[TMR] User ID loaded:', currentUserId);
        }
    } catch (err) {
        console.error('[TMR] Failed to load user ID:', err);
    }
}

// Make localStorage keys user-specific
function getStorageKey(baseKey) {
    if (!currentUserId) return baseKey;
    return `${baseKey}_user${currentUserId}`;
}

// ========== Server-side data management ==========

// Events API
async function fetchEvents() {
    try {
        const res = await fetch('/events');
        if (res.ok) {
            const data = await res.json();
            return data.events || [];
        }
    } catch (err) {
        console.error('[TMR] Fetch events error:', err);
    }
    return [];
}

async function createEvent(event) {
    try {
        const res = await fetch('/events/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event })
        });
        if (res.ok) {
            const data = await res.json();
            return data.eventId;
        }
    } catch (err) {
        console.error('[TMR] Create event error:', err);
    }
    return null;
}

async function updateEvent(eventId, event) {
    try {
        const res = await fetch(`/events/${eventId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event })
        });
        return res.ok;
    } catch (err) {
        console.error('[TMR] Update event error:', err);
    }
    return false;
}

async function deleteEvent(eventId) {
    try {
        const res = await fetch(`/events/${eventId}`, { method: 'DELETE' });
        return res.ok;
    } catch (err) {
        console.error('[TMR] Delete event error:', err);
    }
    return false;
}

// Todos API
async function fetchTodos() {
    try {
        const res = await fetch('/todos');
        if (res.ok) {
            const data = await res.json();
            return data.todos || [];
        }
    } catch (err) {
        console.error('[TMR] Fetch todos error:', err);
    }
    return [];
}

async function createTodo(todo) {
    try {
        const res = await fetch('/todos/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ todo })
        });
        if (res.ok) {
            const data = await res.json();
            return data.todoId;
        }
    } catch (err) {
        console.error('[TMR] Create todo error:', err);
    }
    return null;
}

async function updateTodo(todoId, todo) {
    try {
        const res = await fetch(`/todos/${todoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ todo })
        });
        return res.ok;
    } catch (err) {
        console.error('[TMR] Update todo error:', err);
    }
    return false;
}

async function deleteTodo(todoId) {
    try {
        const res = await fetch(`/todos/${todoId}`, { method: 'DELETE' });
        return res.ok;
    } catch (err) {
        console.error('[TMR] Delete todo error:', err);
    }
    return false;
}

// Initialize user ID immediately
initializeUserId().catch(err => console.error('[TMR] Init error:', err));

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

    function isValidHexAccent(value) {
        if (typeof value !== 'string') return false;
        const v = value.trim();
        return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
    }
    function normalizeHex(value) {
        const v = String(value || '').trim();
        if (!isValidHexAccent(v)) return '';
        if (v.length === 4) return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
        return v;
    }
    function getBootAccent() {
        try {
            const raw = localStorage.getItem('tmr_boot_theme');
            if (!raw) return '';
            const parsed = JSON.parse(raw);
            const a = parsed && typeof parsed.accentColor === 'string' ? parsed.accentColor.trim() : '';
            return a || '';
        } catch (_) {
            return '';
        }
    }
    function getInitialAccent() {
        const root = document.documentElement;
        const inline = (root && root.style ? root.style.getPropertyValue('--accent-color') : '') || '';
        if (inline.trim()) return inline.trim();

        const boot = getBootAccent();
        if (boot) return boot;

        // Prefer theme system key first, then legacy key.
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
    
    function initAccentPicker() {
        const picker = document.getElementById('accent-picker');
        const preview = document.getElementById('accent-preview');
        const saved = getInitialAccent();
        const savedHex = normalizeHex(saved);
        const fallbackHex = '#0089f1';
        
        console.log('[Accent] Init. Picker:', !!picker, 'Preview:', !!preview, 'Saved:', saved);
        
        if(!picker) {
            console.error('[Accent] Picker not found!');
            return false;
        }
        
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
        
        // Apply on load only when we have an explicit saved accent.
        // (Avoid forcing default blue and causing a visible flash.)
        if (savedHex) {
            applyAccent(savedHex);
            if(preview) preview.style.backgroundColor = savedHex;
            picker.value = savedHex;
        } else {
            // Keep the existing (pre-paint) accent if present; otherwise the CSS fallback will apply.
            picker.value = fallbackHex;
            if(preview) {
                const existing = (document.documentElement.style.getPropertyValue('--accent-color') || '').trim();
                preview.style.backgroundColor = existing || fallbackHex;
            }
        }
        console.log('[Accent] Picker found, value set to:', picker.value);
        
        // Update on input (while dragging) and on change
        function updateColor(hex) {
            console.log('[Accent] updateColor called with:', hex);
            localStorage.setItem(ACCENT_KEY, hex);
            // Keep theme system key in sync so other pages (and boot snapshot synthesis) see it.
            try { localStorage.setItem('theme_accent_color', hex); } catch (_) {}
            applyAccent(hex);
            if(preview) {
                console.log('[Accent] Updating preview to:', hex);
                preview.style.backgroundColor = hex;
            }
        }
        
        picker.addEventListener('input', (e) => {
            console.log('[Accent] input event fired, value:', e.target.value);
            updateColor(e.target.value);
        });
        picker.addEventListener('change', (e) => {
            console.log('[Accent] change event fired, value:', e.target.value);
            updateColor(e.target.value);
        });
        
        console.log('[Accent] Initialized successfully');
        return true;
    }
    
    function start(){
        // Try to init immediately
        if(!initAccentPicker()) {
            // If it fails, wait for DOM to be ready
            if(document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initAccentPicker);
            }
        }
    }

    // Wait for auth session restore to finish so localStorage is correctly namespaced.
    if (typeof AuthClient !== 'undefined' && AuthClient && AuthClient.ready && typeof AuthClient.ready.then === 'function') {
        AuthClient.ready.then(start).catch(start);
    } else {
        start();
    }
})();

// Themes modal control
(function(){
    function initThemesModal() {
        const themesBtn = document.getElementById('header-themes-btn');
        const themesModal = document.getElementById('themes-modal-backdrop');
        const themesCloseBtn = document.getElementById('themes-modal-close');
        const themesCloseBtnFooter = document.getElementById('themes-close-btn');
        
        console.log('[Themes] Initializing modal. Button:', !!themesBtn, 'Modal:', !!themesModal);
        
        if(!themesBtn || !themesModal) {
            console.warn('[Themes] Modal elements not found. Will retry on load.');
            return false;
        }
        
        function openThemesModal() {
            console.log('[Themes] Opening modal');
            themesModal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
        
        function closeThemesModal() {
            console.log('[Themes] Closing modal');
            themesModal.style.display = 'none';
            document.body.style.overflow = '';
        }
        
        themesBtn.addEventListener('click', openThemesModal);
        if(themesCloseBtn) themesCloseBtn.addEventListener('click', closeThemesModal);
        if(themesCloseBtnFooter) themesCloseBtnFooter.addEventListener('click', closeThemesModal);
        themesModal.addEventListener('click', (e) => {
            if(e.target === themesModal) closeThemesModal();
        });
        
        console.log('[Themes] Modal initialized successfully');
        return true;
    }
    
    // Try to init immediately
    if(!initThemesModal()) {
        // If it fails, wait for DOM to be ready
        if(document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initThemesModal);
        }
    }
})();

// Background Image Handler
(function(){
    const BG_IMAGE_KEY = 'tmr_bg_image';
    
    function initBackgroundImage() {
        const fileInput = document.getElementById('bg-image-upload');
        const clearBtn = document.getElementById('bg-image-clear-btn');
        const previewContainer = document.getElementById('bg-image-preview-container');
        const previewImg = document.getElementById('bg-image-preview');
        const noneText = document.getElementById('bg-image-none-text');
        
        console.log('[BgImage] Initializing. Upload input:', !!fileInput);
        
        if(!fileInput) {
            console.error('[BgImage] Upload input not found');
            return false;
        }
        
        // Load and display stored image on init
        const stored = localStorage.getItem(getStorageKey(BG_IMAGE_KEY));
        if(stored) {
            console.log('[BgImage] Found stored image');
            previewImg.src = stored;
            previewContainer.style.display = 'flex';
            noneText.style.display = 'none';
            applyBackgroundImage(stored);
        }
        
        function applyBackgroundImage(dataUrl) {
            if(dataUrl) {
                console.log('[BgImage] Applying background image');
                document.body.classList.remove('triangle-background');
                document.body.style.backgroundImage = `url('${dataUrl}')`;
                document.body.style.backgroundSize = 'cover';
                document.body.style.backgroundPosition = 'center';
                document.body.style.backgroundAttachment = 'fixed';
                document.body.style.backgroundRepeat = 'no-repeat';
            } else {
                console.log('[BgImage] Clearing background image, restoring default triangles');
                // Clear ALL inline background styles
                document.body.style.backgroundImage = '';
                document.body.style.backgroundSize = '';
                document.body.style.backgroundPosition = '';
                document.body.style.backgroundAttachment = '';
                document.body.style.backgroundRepeat = '';
                // Re-add triangle class
                document.body.classList.add('triangle-background');
            }
        }
        
        function clearBackgroundImage() {
            console.log('[BgImage] Clearing image');
            localStorage.removeItem(getStorageKey(BG_IMAGE_KEY));
            fileInput.value = '';
            previewContainer.style.display = 'none';
            noneText.style.display = 'block';
            applyBackgroundImage(null);
        }
        
        // Handle file upload
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if(!file) return;
            
            console.log('[BgImage] File selected:', file.name);
            const reader = new FileReader();
            
            reader.onload = (event) => {
                const dataUrl = event.target.result;
                console.log('[BgImage] File read, storing and applying');
                localStorage.setItem(getStorageKey(BG_IMAGE_KEY), dataUrl);
                previewImg.src = dataUrl;
                previewContainer.style.display = 'flex';
                noneText.style.display = 'none';
                applyBackgroundImage(dataUrl);
            };
            
            reader.onerror = () => {
                console.error('[BgImage] Error reading file');
            };
            
            reader.readAsDataURL(file);
        });
        
        // Handle clear button
        clearBtn.addEventListener('click', clearBackgroundImage);
        
        console.log('[BgImage] Initialized successfully');
        return true;
    }
    
    function start(){
        // Try to init immediately
        if(!initBackgroundImage()) {
            // If it fails, wait for DOM to be ready
            if(document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initBackgroundImage);
            }
        }
    }

    // Wait for auth session restore to finish so localStorage is correctly namespaced.
    if (typeof AuthClient !== 'undefined' && AuthClient && AuthClient.ready && typeof AuthClient.ready.then === 'function') {
        AuthClient.ready.then(start).catch(start);
    } else {
        start();
    }
})();

// Dropdown toggle for the TMR header menu (in page header - desktop only)
(function(){
    const toggle = document.getElementById('tmr-header-btn');
    const menu = document.getElementById('tmr-header-menu');
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

    // Keyboard support (Enter/Space to open)
    toggle.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter' || e.key === ' '){
            e.preventDefault();
            if(menu.hidden) openMenu(); else closeMenu();
        }
    });
})();

// Header buttons: Notes (placeholder handler for now)
(function(){
    const notesBtn = document.getElementById('header-notes-btn');

    if(notesBtn){
        notesBtn.addEventListener('click', () => {
            console.log('[Header] Notes button clicked - navigating to NotesHQ');
            window.location.href = 'NotesHQ.html';
        });
    }
})();

// Header button: Logout / Create Account
(function(){
    const logoutBtn = document.getElementById('header-logout-btn');

    if(logoutBtn){
        // Check if guest mode
        const guestMode = localStorage.getItem('guest_mode');
        
        if (guestMode) {
            // Guest mode: change button to "Create Account"
            logoutBtn.textContent = '➕ Create Account';
            logoutBtn.addEventListener('click', () => {
                console.log('[Header] Create Account button clicked (guest mode)');
                window.location.href = 'intro.html';
            });
        } else {
            // Logged in: normal logout button
            logoutBtn.addEventListener('click', async () => {
                console.log('[Header] Logout button clicked');
                
                try {
                    const res = await fetch('/auth/logout', {
                        method: 'POST',
                        credentials: 'include'
                    });
                    
                    if (res.ok) {
                        // Clear local user data
                        localStorage.removeItem('user_id');
                        localStorage.removeItem('guest_mode');
                        console.log('[Header] Logout successful');
                        // Redirect to intro
                        window.location.href = 'intro.html';
                    } else {
                        console.error('[Header] Logout failed:', res.status);
                        alert('Logout failed');
                    }
                } catch (err) {
                    console.error('[Header] Logout error:', err);
                    alert('Logout error: ' + err.message);
                }
            });
        }
    }
})();

// Header: Display username
(function(){
    const usernameSpan = document.getElementById('header-username');
    if (!usernameSpan) return; // Element doesn't exist on this page
    
    const guestMode = localStorage.getItem('guest_mode');
    
    if (guestMode) {
        // Guest mode
        usernameSpan.textContent = '👤 Guest';
    } else {
        // Fetch username from server
        fetch('/auth/verify', {
            credentials: 'include'
        })
        .then(res => res.json())
        .then(data => {
            if (data.ok && data.username) {
                usernameSpan.textContent = `👤 ${data.username}`;
            } else {
                usernameSpan.textContent = '👤 User';
            }
        })
        .catch(err => {
            console.error('[Header] Failed to fetch username:', err);
            usernameSpan.textContent = '👤 User';
        });
    }
})();

// Header search functionality with fuzzy matching and debounce
(function(){
    const searchInput = document.getElementById('header-search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    const suggestions = document.getElementById('search-suggestions');

    if(!searchInput) return;

    let searchTimeout;
    let selectedResultIndex = -1;

    // ===== SEARCH HELPERS =====
    
    // Fuzzy search: check if query is loosely contained in text (case-insensitive)
    function fuzzyMatch(query, text) {
        if (!query || !text) return false;
        const q = query.toLowerCase();
        const t = text.toLowerCase();
        
        // Exact substring match
        if (t.includes(q)) return true;
        
        // Loose fuzzy match: find all chars of query in sequence in text
        let queryIdx = 0;
        for (let i = 0; i < t.length && queryIdx < q.length; i++) {
            if (t[i] === q[queryIdx]) queryIdx++;
        }
        return queryIdx === q.length;
    }

    // Calculate relevance score (higher = better match)
    function calculateRelevance(query, title, content, date) {
        let score = 0;
        const q = query.toLowerCase();
        
        // Title exact match: 100 points
        if (title && title.toLowerCase() === q) score += 100;
        // Title contains: 80 points
        else if (title && title.toLowerCase().includes(q)) score += 80;
        // Title fuzzy match: 70 points
        else if (title && fuzzyMatch(q, title)) score += 70;
        
        // Content contains: 60 points
        if (content && content.toLowerCase().includes(q)) score += 60;
        // Content fuzzy match: 40 points
        else if (content && fuzzyMatch(q, content)) score += 40;
        
        // Date proximity bonus: if date exists, bonus for recent dates
        if (date) {
            const eventDate = new Date(date).getTime();
            const now = Date.now();
            const daysDiff = Math.abs((eventDate - now) / (1000 * 60 * 60 * 24));
            if (daysDiff <= 7) score += 30;  // Within 7 days: +30
            else if (daysDiff <= 30) score += 15; // Within 30 days: +15
        }
        
        return score;
    }

    // Get events from calendar
    function getCalendarEvents() {
        try {
            const events = JSON.parse(localStorage.getItem('tmr_events') || '[]');
            return events.map(e => ({
                id: e.id,
                type: 'event',
                icon: '📅',
                title: e.title || 'Untitled Event',
                content: e.notes || '',
                date: e.date,
                timeStr: e.time || '',
                color: e.color || '#ff922b'
            }));
        } catch (e) {
            console.warn('[Search] Failed to load events:', e);
            return [];
        }
    }

    // Get todos
    function getTodos() {
        try {
            const todos = JSON.parse(localStorage.getItem('tmr_todos') || '[]');
            return todos.map(t => ({
                id: t.id,
                type: 'todo',
                icon: '✓',
                title: t.text || 'Untitled Todo',
                content: '',
                date: null,
                completed: t.completed || false
            }));
        } catch (e) {
            console.warn('[Search] Failed to load todos:', e);
            return [];
        }
    }

    // Get notes (placeholder - will be replaced with actual notes)
    function getNotes() {
        try {
            const notes = JSON.parse(localStorage.getItem('tmr_notes') || '[]');
            return notes.map(n => ({
                id: n.id,
                type: 'note',
                icon: '📝',
                title: n.title || 'Untitled Note',
                content: n.content || '',
                date: null
            }));
        } catch (e) {
            console.warn('[Search] Failed to load notes:', e);
            return [];
        }
    }

    // Main search function
    function performSearch(query) {
        if (!query || query.trim().length === 0) {
            suggestions.hidden = true;
            suggestions.innerHTML = '';
            selectedResultIndex = -1;
            return;
        }

        // Collect all results
        const allResults = [
            ...getCalendarEvents(),
            ...getTodos(),
            ...getNotes()
        ];

        // Score and filter results
        const scored = allResults
            .map(item => ({
                ...item,
                score: calculateRelevance(query, item.title, item.content, item.date)
            }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);  // Top 5 results

        // Display results
        displayResults(scored, query);
        selectedResultIndex = -1;
    }

    // Convert score to star rating with better visual distinction
    function scoreToStars(score) {
        const maxScore = 130;
        const normalized = Math.min(5, Math.max(1, Math.round((score / maxScore) * 5)));
        
        // Create HTML with styled stars - filled stars (⭐) and outline stars (☆)
        const filled = '<span class="star-filled">⭐</span>'.repeat(normalized);
        const outline = '<span class="star-outline">☆</span>'.repeat(5 - normalized);
        return filled + outline;
    }

    // Display search results
    function displayResults(results, query) {
        if (results.length === 0) {
            suggestions.innerHTML = '<div class="search-suggestion-item" style="text-align:center;color:#999;cursor:default;pointer-events:none;">No results found</div>';
            suggestions.hidden = false;
            return;
        }

        suggestions.innerHTML = results.map((item, idx) => {
            const dateStr = item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
            const timeStr = item.timeStr ? ` ${item.timeStr}` : '';
            const subtitle = dateStr ? `${dateStr}${timeStr}` : (item.completed ? '(Completed)' : '');
            
            return `
                <div class="search-suggestion-item" data-result-index="${idx}" data-id="${item.id}" data-type="${item.type}">
                    <div class="suggestion-content">
                        <div class="suggestion-title">${item.icon} ${escapeHtml(item.title)}</div>
                        ${subtitle ? `<div class="suggestion-subtitle">${escapeHtml(subtitle)}</div>` : ''}
                    </div>
                    <div class="suggestion-stars">${scoreToStars(item.score)}</div>
                </div>
            `;
        }).join('');

        suggestions.hidden = false;

        // Add click handlers
        document.querySelectorAll('.search-suggestion-item').forEach((el, idx) => {
            el.addEventListener('click', () => selectResult(idx, results));
        });
    }

    // Jump to result
    function selectResult(idx, results) {
        const result = results[idx];
        if (!result) return;

        suggestions.hidden = true;
        searchInput.value = '';

        jumpToResult(result);
    }

    // Navigate to result (scroll/jump)
    function jumpToResult(result) {
        if (result.type === 'event') {
            // Scroll calendar to date and highlight event
            console.log('[Search] Jumping to event:', result.title, 'on', result.date);
            // TODO: Implement calendar navigation when search-specific logic is ready
            // For now, just log
            try {
                window.dispatchEvent(new CustomEvent('search:navigate', { 
                    detail: { type: 'event', id: result.id, date: result.date } 
                }));
            } catch (e) { }
        } else if (result.type === 'todo') {
            // Scroll todo list to item
            console.log('[Search] Jumping to todo:', result.title);
            try {
                window.dispatchEvent(new CustomEvent('search:navigate', { 
                    detail: { type: 'todo', id: result.id } 
                }));
            } catch (e) { }
        } else if (result.type === 'note') {
            // Navigate to notes editor
            console.log('[Search] Jumping to note:', result.title);
            // TODO: Navigate to notes-editor.html?id=<noteId>
            try {
                window.dispatchEvent(new CustomEvent('search:navigate', { 
                    detail: { type: 'note', id: result.id } 
                }));
            } catch (e) { }
        }
    }

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Debounced search
    function debounceSearch(query) {
        clearTimeout(searchTimeout);
        if (query.trim().length === 0) {
            suggestions.hidden = true;
            return;
        }
        searchTimeout = setTimeout(() => {
            performSearch(query);
        }, 300);  // 300ms debounce
    }

    // Clear search
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchInput.focus();
        suggestions.hidden = true;
        selectedResultIndex = -1;
    });

    // Ctrl+F focus search
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            searchInput.focus();
        }
    });

    // Search with debounce on input
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        debounceSearch(query);
    });

    // Keyboard navigation (arrow keys, enter, escape)
    searchInput.addEventListener('keydown', (e) => {
        const items = suggestions.querySelectorAll('.search-suggestion-item');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedResultIndex = Math.min(selectedResultIndex + 1, items.length - 1);
            updateHighlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedResultIndex = Math.max(selectedResultIndex - 1, -1);
            updateHighlight(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedResultIndex >= 0 && selectedResultIndex < items.length) {
                items[selectedResultIndex].click();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            suggestions.hidden = true;
            selectedResultIndex = -1;
        }
    });

    function updateHighlight(items) {
        items.forEach((item, idx) => {
            if (idx === selectedResultIndex) {
                item.classList.add('highlighted');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('highlighted');
            }
        });
    }

    // Close suggestions on blur
    searchInput.addEventListener('blur', () => {
        setTimeout(() => {
            suggestions.hidden = true;
            selectedResultIndex = -1;
        }, 200);
    });

    // Focus shows existing suggestions if not empty
    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim().length > 0 && !suggestions.hidden) {
            suggestions.hidden = false;
        }
    });
})();

// Search result navigation handlers
(function(){
    // Listen for search navigation events and jump to items
    window.addEventListener('search:navigate', (e) => {
        const { type, id, date } = e.detail;

        if (type === 'event') {
            navigateToEvent(id, date);
        } else if (type === 'todo') {
            navigateToTodo(id);
        } else if (type === 'note') {
            navigateToNote(id);
        }
    });

    // Navigate to calendar event
    function navigateToEvent(eventId, eventDate) {
        try {
            console.log('[Search Navigation] Starting navigateToEvent with eventId:', eventId);
            const events = JSON.parse(localStorage.getItem('tmr_events') || '[]');
            const event = events.find(e => e.id === eventId);
            if (!event) {
                console.warn('[Search Navigation] Event not found:', eventId);
                return;
            }

            console.log('[Search Navigation] Found event:', event);
            console.log('[Search Navigation] Checking for window.openModalForDate...');
            console.log('[Search Navigation] window.openModalForDate =', window.openModalForDate);

            // Call the calendar's openModalForDate function if available
            // This will display the modal with events for the date
            if (window.openModalForDate && typeof window.openModalForDate === 'function') {
                console.log('[Search Navigation] Calling openModalForDate with date:', event.date);
                window.openModalForDate(event.date);
                console.log('[Search Navigation] Opened event modal for:', event.title, 'on', event.date);
            } else {
                console.warn('[Search Navigation] openModalForDate function not available');
                console.warn('[Search Navigation] window object keys related to modal:', Object.keys(window).filter(k => k.includes('modal') || k.includes('Modal')));
            }
        } catch (err) {
            console.error('[Search Navigation] Error navigating to event:', err);
        }
    }

    // Navigate to todo
    function navigateToTodo(todoId) {
        try {
            const todos = JSON.parse(localStorage.getItem('tmr_todos') || '[]');
            const todo = todos.find(t => t.id === todoId);
            if (!todo) {
                console.warn('[Search Navigation] Todo not found:', todoId);
                return;
            }

            // Call the todo's openViewModal function if available
            // This will display the todo view modal
            if (window.openViewModal && typeof window.openViewModal === 'function') {
                window.openViewModal(todoId);
                console.log('[Search Navigation] Opened todo modal for:', todo.text);
            } else {
                console.warn('[Search Navigation] openViewModal function not available');
            }
        } catch (err) {
            console.error('[Search Navigation] Error navigating to todo:', err);
        }
    }

    // Navigate to note (placeholder - will be expanded when notes page exists)
    function navigateToNote(noteId) {
        try {
            const notes = JSON.parse(localStorage.getItem('tmr_notes') || '[]');
            const note = notes.find(n => n.id === noteId);
            if (!note) {
                console.warn('[Search Navigation] Note not found:', noteId);
                return;
            }

            // TODO: When notes-editor.html exists, navigate to it
            // window.location.href = `notes-editor.html?id=${noteId}`;
            
            console.log('[Search Navigation] Navigating to note:', note.title);
            alert('Notes feature coming soon! Note: ' + note.title);
        } catch (err) {
            console.error('[Search Navigation] Error navigating to note:', err);
        }
    }
})();

/* Dropdown toggle for the TMR tag menu */
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
    // Delay todo init until auth session restore completes so we don't touch the anon namespace
    // while an authenticated session is still loading.
    const run = () => {
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
        console.log('[showSystemNotification] Attempting to show:', { title, opts, hasNotification: 'Notification' in window, permission: Notification.permission });
        if(!('Notification' in window)) { console.log('[showSystemNotification] Notifications not supported'); return; }
        if(Notification.permission !== 'granted'){ console.log('[showSystemNotification] Permission not granted'); return; }
        try{ 
            const n = new Notification(title, opts); 
            console.log('[showSystemNotification] Successfully created notification');
        }catch(e){ 
            console.error('[showSystemNotification] Failed to create notification:', e.message, e);
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
        const modalList = document.getElementById('todo-modal-list');
        
        // Desktop elements
        const desktopList = document.getElementById('todo-list');
        const desktopCreateBtn = document.getElementById('desktop-create-todo-btn');
        
        // Desktop VIEW modal elements
        const viewModalBackdrop = document.getElementById('todo-view-modal-backdrop');
        const viewModalTitle = document.getElementById('todo-view-title');
        const viewModalNotes = document.getElementById('todo-view-notes');
        const viewModalEditBtn = document.getElementById('todo-view-edit-btn');
        const viewModalCloseBtn = document.getElementById('todo-view-close-btn');
        
        // Desktop CREATE/EDIT modal elements
        const createEditModalBackdrop = document.getElementById('todo-create-edit-modal-backdrop');
        const createEditModalTitle = document.getElementById('todo-create-edit-modal-title');
        const createEditTitle = document.getElementById('todo-edit-title');
        const createEditNotes = document.getElementById('todo-edit-notes');
        const createEditReminderType = document.getElementById('todo-edit-reminder-type');
        const createEditReminderMinutes = document.getElementById('todo-edit-reminder-minutes');
        const createEditReminderTime = document.getElementById('todo-edit-reminder-time');
        const createEditSaveBtn = document.getElementById('todo-edit-save-btn');
        const createEditCancelBtn = document.getElementById('todo-edit-cancel-btn');

        // Check required elements
        if(!backdrop || !modalList) return;
        if(!desktopList || !desktopCreateBtn || !viewModalBackdrop || !createEditModalBackdrop) return;
        
        // Helper function to calculate reminder timestamp from type and value
        function getReminderTimestamp(reminderType, minutesValue, timeValue) {
            console.log('[getReminderTimestamp] Called with:', { reminderType, minutesValue, timeValue });
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
                console.log('[getReminderTimestamp] Parsing time:', { timeValue, hours, mins, hoursIsNaN: isNaN(hours), minsIsNaN: isNaN(mins) });
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
        
        // Setup for desktop CREATE/EDIT modal reminder selector
        if (createEditReminderType) setupReminderTypeSelector(createEditReminderType, createEditReminderMinutes, createEditReminderTime);
        
        // Modal open/close functions for desktop/mobile
        function openViewModal(todoId){
            const todos = loadTodos();
            const todo = todos.find(t => t.id === todoId);
            if(!todo) return;
            
            viewModalTitle.textContent = todo.text || '';
            viewModalNotes.textContent = todo.notes || '(No notes)';
            
            // Store current todo id so Edit button knows which one to edit
            viewModalBackdrop._currentTodoId = todoId;
            
            viewModalBackdrop.style.display = '';
            viewModalBackdrop.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
        
        function closeViewModal(){
            viewModalBackdrop.style.display = 'none';
            viewModalBackdrop.classList.remove('active');
            document.body.style.overflow = '';
        }

        // Export functions to window for external use (e.g., search navigation)
        window.openViewModal = openViewModal;
        window.closeViewModal = closeViewModal;
        
        function openCreateEditModal(todoId){
            const todos = loadTodos();
            const isEdit = todoId !== null && todoId !== undefined;
            const todo = isEdit ? todos.find(t => t.id === todoId) : null;
            
            // Set title
            createEditModalTitle.textContent = isEdit ? 'Edit Todo' : 'Create Todo';
            
            // Populate fields
            createEditTitle.value = todo ? (todo.text || '') : '';
            createEditNotes.value = todo ? (todo.notes || '') : '';
            createEditReminderType.value = 'none';
            createEditReminderMinutes.value = '';
            createEditReminderTime.value = '';
            createEditReminderMinutes.style.display = 'none';
            createEditReminderTime.style.display = 'none';
            
            // If editing and has reminder, prefill it
            if(isEdit && todo && todo.reminderAt){
                const now = Date.now();
                const reminderMs = Number(todo.reminderAt);
                const minsLeft = Math.max(0, Math.ceil((reminderMs - now)/60000));
                if(minsLeft < 1440){ // less than 24 hours - assume relative
                    createEditReminderType.value = 'minutes';
                    createEditReminderMinutes.value = String(minsLeft);
                    createEditReminderMinutes.style.display = 'block';
                } else {
                    // assume specific time
                    const reminderDate = new Date(reminderMs);
                    const hours = String(reminderDate.getHours()).padStart(2, '0');
                    const mins = String(reminderDate.getMinutes()).padStart(2, '0');
                    createEditReminderType.value = 'time';
                    createEditReminderTime.value = hours + ':' + mins;
                    createEditReminderTime.style.display = 'block';
                }
            }
            
            // Store todoId for save function
            createEditModalBackdrop._currentTodoId = todoId;
            
            createEditModalBackdrop.style.display = '';
            createEditModalBackdrop.classList.add('active');
            document.body.style.overflow = 'hidden';
            createEditTitle.focus();
        }
        
        function closeCreateEditModal(){
            createEditModalBackdrop.style.display = 'none';
            createEditModalBackdrop.classList.remove('active');
            document.body.style.overflow = '';
        }
        
        function closeAllDesktopModals(){
            closeViewModal();
            closeCreateEditModal();
        }
        
        // Unified render function that updates BOTH desktop and mobile lists
        function renderTodos(){
            const todos = loadTodos();
            
            // Render mobile modal list (keep existing inline edit behavior)
            modalList.innerHTML = '';
            
            // Render desktop list (new: show titles only, click to view)
            if(desktopList) desktopList.innerHTML = '';
            
            todos.forEach(t => {
                // MOBILE: Create todo item with modal workflow (same as desktop)
                const createMobileTodoLi = () => {
                    const li = document.createElement('li'); 
                    li.className = 'todo-item'; 
                    li.dataset.id = t.id;
                    li.style.padding = '12px 8px';
                    li.style.border = 'none';
                    li.style.display = 'flex';
                    li.style.justifyContent = 'space-between';
                    li.style.alignItems = 'center';
                    
                    // Add checkbox for completion
                    const cb = document.createElement('input'); 
                    cb.type = 'checkbox'; 
                    cb.className = 'todo-check';
                    cb.checked = t.completed || false;
                    cb.style.cursor = 'pointer';
                    cb.style.width = '18px';
                    cb.style.height = '18px';
                    cb.style.marginRight = '8px';
                    cb.addEventListener('change', ()=>{ 
                        const todos = loadTodos(); 
                        const idx = todos.findIndex(x=>x.id===t.id); 
                        if(idx>=0){ 
                            todos[idx].completed = cb.checked; 
                            saveTodos(todos); 
                            renderTodos(); 
                        } 
                    });
                    
                    const textWrap = document.createElement('div'); 
                    textWrap.className = 'todo-text';
                    textWrap.style.flex = '1';
                    
                    const span = document.createElement('span'); 
                    span.textContent = t.text || '(No title)'; 
                    span.style.cursor = t.completed ? 'not-allowed' : 'pointer';
                    if(t.completed){ 
                        span.style.textDecoration = 'line-through'; 
                        span.style.opacity = '0.6'; 
                        span.style.color = '#999'; 
                    }
                    // Only open modal if NOT completed
                    if(!t.completed){
                        span.addEventListener('click', ()=> openViewModal(t.id));
                    }
                    
                    const delBtn = document.createElement('button'); 
                    delBtn.className='small-tmr-btn'; 
                    delBtn.textContent='Delete'; 
                    delBtn.style.marginLeft = '8px';
                    delBtn.addEventListener('click', ()=>{ 
                        if(!confirm('Delete this todo?')) return; 
                        const remaining = loadTodos().filter(x=>x.id!==t.id); 
                        saveTodos(remaining); 
                        renderTodos(); 
                    });

                    textWrap.appendChild(span);
                    li.appendChild(cb); 
                    li.appendChild(textWrap); 
                    li.appendChild(delBtn);
                    return li;
                };
                
                // Add to mobile modal at TOP
                if(modalList.firstChild){
                    modalList.insertBefore(createMobileTodoLi(), modalList.firstChild);
                } else {
                    modalList.appendChild(createMobileTodoLi());
                }
                
                // DESKTOP: Create todo item (title only, click to view)
                if(desktopList) {
                    const li = document.createElement('li'); 
                    li.className = 'todo-item'; 
                    li.dataset.id = t.id;
                    li.style.padding = '12px 8px';
                    li.style.border = 'none';
                    li.style.display = 'flex';
                    li.style.justifyContent = 'space-between';
                    li.style.alignItems = 'center';
                    
                    // Add checkbox for strikethrough
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = t.completed || false;
                    checkbox.style.cursor = 'pointer';
                    checkbox.style.width = '18px';
                    checkbox.style.height = '18px';
                    checkbox.style.marginRight = '8px';
                    checkbox.addEventListener('change', (e)=>{
                        const todos = loadTodos();
                        const idx = todos.findIndex(x => x.id === t.id);
                        if(idx >= 0){
                            todos[idx].completed = e.target.checked;
                            saveTodos(todos);
                            renderTodos();
                        }
                    });
                    
                    const textSpan = document.createElement('span');
                    textSpan.textContent = t.text || '(No title)';
                    textSpan.style.flex = '1';
                    textSpan.style.cursor = t.completed ? 'not-allowed' : 'pointer';
                    if(t.completed){
                        textSpan.style.textDecoration = 'line-through';
                        textSpan.style.opacity = '0.6';
                        textSpan.style.color = '#999';
                    }
                    // Only open modal if NOT completed
                    if(!t.completed){
                        textSpan.addEventListener('click', ()=> openViewModal(t.id));
                    }
                    
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'small-tmr-btn';
                    deleteBtn.textContent = '✕';
                    deleteBtn.style.marginLeft = '8px';
                    deleteBtn.addEventListener('click', (e)=>{
                        e.stopPropagation();
                        if(!confirm('Delete this todo?')) return;
                        const remaining = loadTodos().filter(x=>x.id!==t.id);
                        saveTodos(remaining);
                        renderTodos();
                    });
                    
                    li.appendChild(checkbox);
                    li.appendChild(textSpan);
                    li.appendChild(deleteBtn);
                    // Add to TOP instead of bottom
                    if(desktopList.firstChild){
                        desktopList.insertBefore(li, desktopList.firstChild);
                    } else {
                        desktopList.appendChild(li);
                    }
                }
            });
        }

        // Listen for Meibot todo creation and re-render
        window.addEventListener('meibotTodoCreated', () => {
            renderTodos(); // Re-render the todo list to show new todo
        });

        // When account changes/restores, re-render from the correct per-user storage.
        window.addEventListener('tmr:auth-changed', () => {
            try { renderTodos(); } catch (e) {}
            try { updateBadge(); } catch (e) {}
            try { rescheduleAll(); } catch (e) {}
        });

// Desktop "+ Create Todo" button
        if(desktopCreateBtn){
            desktopCreateBtn.addEventListener('click', ()=>{
                openCreateEditModal(null);
            });
        }

        // Mobile "+ Create Todo" button
        const mobileCreateBtn = document.getElementById('todo-modal-create-btn');
        if(mobileCreateBtn){
            mobileCreateBtn.addEventListener('click', ()=>{
                openCreateEditModal(null);
            });
        }
        
        // View Modal: Edit button
        if(viewModalEditBtn){
            viewModalEditBtn.addEventListener('click', ()=>{
                const todoId = viewModalBackdrop._currentTodoId;
                closeViewModal();
                openCreateEditModal(todoId);
            });
        }
        
        // View Modal: Close button
        if(viewModalCloseBtn){
            viewModalCloseBtn.addEventListener('click', closeViewModal);
        }
        
        // View Modal: Click backdrop to close
        if(viewModalBackdrop){
            viewModalBackdrop.addEventListener('click', (e)=>{
                if(e.target === viewModalBackdrop) closeViewModal();
            });
        }
        
        // Create/Edit Modal: Save button
        if(createEditSaveBtn){
            createEditSaveBtn.addEventListener('click', ()=>{
                const title = createEditTitle.value.trim();
                if(!title) {
                    alert('Title is required');
                    return;
                }
                
                const todos = loadTodos();
                const todoId = createEditModalBackdrop._currentTodoId;
                const isNew = todoId === null || todoId === undefined;
                
                if(isNew){
                    // Create new todo
                    const item = {
                        id: generateId(),
                        text: title,
                        notes: createEditNotes.value.trim(),
                        completed: false,
                        reminderAt: null
                    };
                    
                    const reminderType = createEditReminderType.value;
                    const reminderTimestamp = getReminderTimestamp(reminderType, createEditReminderMinutes.value, createEditReminderTime.value);
                    if(reminderTimestamp) item.reminderAt = reminderTimestamp;
                    
                    todos.push(item);
                    
                    // Schedule reminder and post to server if needed
                    if(item.reminderAt && getNotifyMode() !== 'local'){
                        (async ()=>{
                            try{
                                const subscriptionId = localStorage.getItem('tmr_push_sub_id');
                                if(!subscriptionId) {
                                    console.warn('[createEdit] No subscription ID available - reminder will not be delivered');
                                    return;
                                }
                                const payload = { subscriptionId: Number(subscriptionId), userId: null, title: 'To-do: ' + (item.text||''), body: item.text || '', deliverAt: Number(item.reminderAt) };
                                console.log('[createEdit] Posting reminder to server:', payload);
                                const res = await serverFetch('/reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                                console.log('[createEdit] Server response:', { ok: res.ok, status: res.status });
                            }catch(err){ console.warn('[createEdit] Failed to persist reminder to server', err); }
                        })();
                    }
                } else {
                    // Edit existing todo
                    const idx = todos.findIndex(t => t.id === todoId);
                    if(idx >= 0){
                        todos[idx].text = title;
                        todos[idx].notes = createEditNotes.value.trim();
                        
                        const reminderType = createEditReminderType.value;
                        const reminderTimestamp = getReminderTimestamp(reminderType, createEditReminderMinutes.value, createEditReminderTime.value);
                        if(reminderTimestamp){
                            todos[idx].reminderAt = reminderTimestamp;
                        } else {
                            delete todos[idx].reminderAt;
                        }
                    }
                }
                
                saveTodos(todos);
                console.log('[createEdit] Saved todo(s)');
                renderTodos();
                closeCreateEditModal();
                
                // Reschedule notifications
                try{ rescheduleAll(); }catch(e){ console.error('[createEdit] rescheduleAll error:', e); }
            });
        }
        
        // Create/Edit Modal: Cancel button
        if(createEditCancelBtn){
            createEditCancelBtn.addEventListener('click', closeCreateEditModal);
        }
        
        // Checkbox Marker Button: Insert ☐ at cursor
        const checkboxMarkerBtn = document.getElementById('checkbox-marker-btn');
        if(checkboxMarkerBtn){
            checkboxMarkerBtn.addEventListener('click', (e)=>{
                e.preventDefault();
                const textarea = document.getElementById('todo-edit-notes');
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const text = textarea.value;
                const newText = text.substring(0, start) + '☐ ' + text.substring(end);
                textarea.value = newText;
                textarea.selectionStart = textarea.selectionEnd = start + 2;
                textarea.focus();
            });
        }
        
        // Bullet Point Button: Insert • at cursor
        const bulletPointBtn = document.getElementById('bullet-point-btn');
        if(bulletPointBtn){
            bulletPointBtn.addEventListener('click', (e)=>{
                e.preventDefault();
                const textarea = document.getElementById('todo-edit-notes');
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const text = textarea.value;
                const newText = text.substring(0, start) + '\n• ' + text.substring(end);
                textarea.value = newText;
                textarea.selectionStart = textarea.selectionEnd = start + 3;
                textarea.focus();
            });
        }
        
        // Create/Edit Modal: Click backdrop to close
        if(createEditModalBackdrop){
            createEditModalBackdrop.addEventListener('click', (e)=>{
                if(e.target === createEditModalBackdrop) closeCreateEditModal();
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e)=>{
            if(e.key === 'Escape'){
                closeAllDesktopModals();
            }
        });
        
        // Mobile button click handler (switch to mobile todo modal)
        if(mobileBtn) {
            mobileBtn.addEventListener('click', (e)=>{ 
                e.stopPropagation(); 
                const menu = document.getElementById('tmr-menu'); if(menu) menu.hidden = true; 
                renderTodos();
            });
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
                    console.log('[Test Notification] Clicked');
                    if(!('Notification' in window)){
                        console.log('[Test Notification] Notifications not supported');
                        alert('Notifications are not supported by this browser.');
                        return;
                    }
                    console.log('[Test Notification] Current permission:', Notification.permission);
                    if(Notification.permission === 'default'){
                        console.log('[Test Notification] Requesting permission...');
                        const perm = await Notification.requestPermission();
                        console.log('[Test Notification] Permission result:', perm);
                        if(perm !== 'granted'){ alert('Notification permission not granted.'); return; }
                    }
                    if(Notification.permission === 'granted'){
                        console.log('[Test Notification] Showing test notification...');
                        try{ showSystemNotification('TMR test', { body: 'This is a test notification.' }); }
                        catch(err){ console.error('[Test Notification] Failed:', err); alert('Failed to show notification'); }
                    } else {
                        console.log('[Test Notification] Permission denied');
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
                        // Ensure credentials are included for session-based auth
                        const finalOpts = { ...opts, credentials: 'include' };

                        // If accessing from ngrok public domain, use ngrok push server for HTTPS support
                        if(location.hostname.includes('ngrok')){
                            try{
                                // Use the same ngrok base URL but keep it as-is for push server (port 3001 forwarding)
                                const url = location.origin + path;
                                console.debug('[serverFetch] using ngrok origin', url);
                                const res = await fetch(url, finalOpts);
                                console.debug('[serverFetch] ngrok response', url, res && res.status);
                                return res;
                            }catch(e){ console.debug('[serverFetch] ngrok fetch failed', e); throw e; }
                        }

                        // try same-origin first; log attempts to help debugging
                        try{
                            console.debug('[serverFetch] trying same-origin', path);
                            const res = await fetch(path, finalOpts);
                            if(res){ console.debug('[serverFetch] same-origin response', path, res.status); }
                            // only accept successful responses here ΓÇö allow fallback to the push server
                            if(res && res.ok) return res;
                        }catch(e){ console.debug('[serverFetch] same-origin fetch failed', e); /* ignore and try fallback */ }

                // fallback to port 3001 on the same host
                try{
                    const base = location && location.hostname ? `${location.protocol}//${location.hostname}:3001` : 'http://localhost:3001';
                    const url = base + (path.startsWith('/') ? path : '/' + path);
                    console.debug('[serverFetch] trying fallback', url);
                    const res2 = await fetch(url, finalOpts);
                    console.debug('[serverFetch] fallback response', url, res2 && res2.status);
                    if(res2 && res2.ok) return res2;
                }catch(e){ console.debug('[serverFetch] fallback fetch failed', e); /* ignore and try ngrok public */ }

                // Last resort: try ngrok public URL for push server (if on local network but need HTTPS for push API)
                try{
                    const url = 'https://sensationistic-taunya-palingenesian.ngrok-free.dev' + (path.startsWith('/') ? path : '/' + path);
                    console.debug('[serverFetch] trying ngrok public fallback', url);
                    const res3 = await fetch(url, finalOpts);
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
                    // Check for pending actions from Docs.html or other pages
                    const pendingActions = JSON.parse(localStorage.getItem('meibot_pending_actions') || '[]');
                    if (pendingActions.length > 0) {
                        console.log('[TMR] Processing pending actions from Meibot:', pendingActions);
                        for (const action of pendingActions) {
                            if (action.type === 'todo' && action.data) {
                                try {
                                    window.calendarAddTodo(action.data.text, action.data.reminder);
                                    console.log('[TMR] Created todo from pending action:', action.data.text);
                                } catch (e) {
                                    console.error('[TMR] Failed to create todo:', e);
                                }
                            } else if (action.type === 'event' && action.data) {
                                try {
                                    const event = {
                                        id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                                        title: action.data.title,
                                        date: action.data.date,
                                        time: action.data.time || '09:00',
                                        duration: action.data.duration || 60,
                                        notes: action.data.text || ''
                                    };
                                    window.calendarAddOrUpdateEvent(event);
                                    console.log('[TMR] Created event from pending action:', action.data.title);
                                } catch (e) {
                                    console.error('[TMR] Failed to create event:', e);
                                }
                            }
                        }
                        // Clear pending actions after processing
                        localStorage.removeItem('meibot_pending_actions');
                        console.log('[TMR] Cleared pending actions');
                    }

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

    };

    if (typeof AuthClient !== 'undefined' && AuthClient && AuthClient.ready && typeof AuthClient.ready.then === 'function') {
        AuthClient.ready.then(run).catch(run);
    } else {
        run();
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
