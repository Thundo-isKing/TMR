/**
 * Client-side authentication management for TMR
 * Handles login, registration, logout, and session persistence
 */

const AuthClient = (() => {
  const SESSION_STORAGE_KEY = 'tmr_auth';
  const CACHE_PREFIX = 'tmr_';

  // Some browsers don't allow replacing `window.localStorage` (read-only accessor).
  // To enforce per-user isolation reliably, patch Storage methods to scope keys.
  // Keep raw (unpatched) method references for AuthClient internal migrations.
  const RAW_FNS_KEY = '__tmrLocalStorageRawFns';
  const SCOPED_PATCH_INSTALLED_KEY = '__tmrScopedLocalStorageInstalled';
  const BOOT_THEME_KEY = 'tmr_boot_theme';

  const getRawLocalStorageFns = () => {
    if (typeof window === 'undefined') return null;
    if (window[RAW_FNS_KEY]) return window[RAW_FNS_KEY];
    try {
      if (typeof Storage === 'undefined' || !Storage || !Storage.prototype) return null;
      window[RAW_FNS_KEY] = {
        getItem: Storage.prototype.getItem,
        setItem: Storage.prototype.setItem,
        removeItem: Storage.prototype.removeItem,
        key: Storage.prototype.key
      };
      return window[RAW_FNS_KEY];
    } catch (e) {
      return null;
    }
  };

  const rawGetItem = (key) => {
    const fns = getRawLocalStorageFns();
    try { return fns ? fns.getItem.call(window.localStorage, key) : localStorage.getItem(key); } catch (_) { return null; }
  };

  const rawSetItem = (key, value) => {
    const fns = getRawLocalStorageFns();
    try { return fns ? fns.setItem.call(window.localStorage, key, value) : localStorage.setItem(key, value); } catch (_) {}
  };

  const rawRemoveItem = (key) => {
    const fns = getRawLocalStorageFns();
    try { return fns ? fns.removeItem.call(window.localStorage, key) : localStorage.removeItem(key); } catch (_) {}
  };

  const rawKeyAt = (index) => {
    const fns = getRawLocalStorageFns();
    try { return fns ? fns.key.call(window.localStorage, index) : localStorage.key(index); } catch (_) { return null; }
  };

  // Allows other modules to wait until the initial /auth/session check completes.
  // This prevents modules from reading/writing under the anonymous namespace
  // while an authenticated session is still being restored.
  let readyResolved = false;
  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });
  const resolveReady = (user) => {
    if (readyResolved) return;
    readyResolved = true;
    try { readyResolve({ user: user || null }); } catch (e) {}
  };

  // Current user state
  let currentUser = null;

  const withTimeout = (promise, ms, label = 'operation') => {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      try { clearTimeout(timer); } catch (e) {}
    });
  };

  const tryGoogleCalendarSyncBeforeLogout = async () => {
    try {
      if (!window.GoogleCalendarClient) return;
      if (typeof window.GoogleCalendarClient.checkStatus !== 'function') return;
      if (typeof window.GoogleCalendarClient.manualSync !== 'function') return;

      const connected = await withTimeout(window.GoogleCalendarClient.checkStatus(), 4000, 'Google Calendar status check');
      if (!connected) return;

      console.log('[Auth] Google Calendar connected; syncing before logout');
      await withTimeout(window.GoogleCalendarClient.manualSync(), 15000, 'Google Calendar sync');
      console.log('[Auth] Google Calendar sync before logout completed');
    } catch (e) {
      // Best-effort: never block logout if sync fails.
      console.warn('[Auth] Pre-logout Google Calendar sync skipped/failed:', e.message);
    }
  };

  const getStorageBackend = () => {
    // Note: Storage methods may be patched to scope keys.
    // Use raw* helpers above for unscoped reads/writes (migrations, clearing).
    return localStorage;
  };

  const safeJsonParse = (value, fallback) => {
    try { return JSON.parse(value); } catch (e) { return fallback; }
  };

  // Migrate ONLY user-owned events from legacy/anon namespaces into the authenticated user's namespace.
  // This is intentionally conservative to avoid cross-account data leakage.
  const migrateOwnedEventsToUserScope = (uid) => {
    if (!uid) return;

    const destKey = `${CACHE_PREFIX}user_${uid}_tmr_events`;
    const destEvents = safeJsonParse(rawGetItem(destKey) || '[]', []);
    const destById = new Set(Array.isArray(destEvents) ? destEvents.map(e => e && e.id).filter(Boolean) : []);

    const sourceKeys = [
      `${CACHE_PREFIX}anon_tmr_events`,
      `${CACHE_PREFIX}tmr_events`,
      `tmr_events`
    ];

    let didMerge = false;
    let merged = Array.isArray(destEvents) ? destEvents.slice() : [];

    for (const key of sourceKeys) {
      const raw = rawGetItem(key);
      if (!raw) continue;
      const sourceEvents = safeJsonParse(raw, []);
      if (!Array.isArray(sourceEvents) || sourceEvents.length === 0) continue;

      // Only migrate events that explicitly match this user.
      const owned = sourceEvents.filter(ev => ev && typeof ev === 'object' && ev.ownerUserId && String(ev.ownerUserId) === String(uid));
      if (owned.length === 0) continue;

      for (const ev of owned) {
        if (!ev.id || destById.has(ev.id)) continue;
        merged.push(ev);
        destById.add(ev.id);
        didMerge = true;
      }

      // If ALL events in the legacy key were owned by this user, it's safe to clear the legacy key.
      const allOwnedByUser = sourceEvents.every(ev => ev && typeof ev === 'object' && ev.ownerUserId && String(ev.ownerUserId) === String(uid));
      if (allOwnedByUser) {
        try { rawRemoveItem(key); } catch (e) {}
      }
    }

    if (didMerge) {
      try { rawSetItem(destKey, JSON.stringify(merged)); } catch (e) {}
      console.log('[Auth] Migrated owned legacy events into user scope');
    }
  };

  // Migrate common data that may have been written while auth was still restoring
  // (i.e., into the anonymous namespace) into this user's namespace.
  // This avoids the "it didn't save" effect when switching accounts.
  const migrateAnonDataToUserScope = (uid) => {
    if (!uid) return;

    const copyIfMissing = (baseKey) => {
      const src = `${CACHE_PREFIX}anon_${baseKey}`;
      const dst = `${CACHE_PREFIX}user_${uid}_${baseKey}`;
      const srcVal = rawGetItem(src);
      if (srcVal == null) return;
      const dstVal = rawGetItem(dst);
      if (dstVal == null) {
        rawSetItem(dst, srcVal);
      }
      rawRemoveItem(src);
    };

    const mergeArrayById = (baseKey) => {
      const src = `${CACHE_PREFIX}anon_${baseKey}`;
      const dst = `${CACHE_PREFIX}user_${uid}_${baseKey}`;
      const srcRaw = rawGetItem(src);
      if (!srcRaw) return;
      let srcArr;
      try { srcArr = JSON.parse(srcRaw); } catch (_) { srcArr = null; }
      if (!Array.isArray(srcArr) || srcArr.length === 0) { rawRemoveItem(src); return; }

      let dstArr;
      try { dstArr = JSON.parse(rawGetItem(dst) || '[]'); } catch (_) { dstArr = []; }
      if (!Array.isArray(dstArr)) dstArr = [];

      const seen = new Set(dstArr.map(t => t && t.id).filter(Boolean));
      let changed = false;
      for (const item of srcArr) {
        const id = item && item.id;
        if (id && seen.has(id)) continue;
        dstArr.push(item);
        if (id) seen.add(id);
        changed = true;
      }

      if (changed) {
        try { rawSetItem(dst, JSON.stringify(dstArr)); } catch (_) {}
      }
      rawRemoveItem(src);
    };

    // Todos and basic appearance settings
    mergeArrayById('tmr_todos');
    copyIfMissing('tmr_accent');
    copyIfMissing('tmr_bg_image');

    // If themes.js is ever loaded, these are its keys
    copyIfMissing('theme_accent_color');
    copyIfMissing('theme_bg_color');
    copyIfMissing('theme_bg_image');
    copyIfMissing('theme_animation');
  };

  /**
   * Initialize auth client - check for existing session
   */
  const init = async () => {
    // Attach event listeners first (they should always be available)
    attachEventListeners();

    let sessionExplicitlyMissing = false;

    try {
      const response = await fetch('/auth/session', {
        credentials: 'include',
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response && response.status === 401) {
        sessionExplicitlyMissing = true;
      }

      if (response.ok) {
        const data = await response.json();
        if (data.user) {
          currentUser = data.user;
          console.log('[Auth] Restored session for user:', currentUser.username);
          showLoggedInUI();
          try { migrateAnonDataToUserScope(currentUser.id); } catch (e) {}
          try { migrateOwnedEventsToUserScope(currentUser.id); } catch (e) {}
          try { updateBootThemeSnapshot(); } catch (e) {}
          try { window.dispatchEvent(new CustomEvent('tmr:auth-changed', { detail: { user: currentUser, restored: true } })); } catch (e) {}

          // Mark auth as ready for other modules.
          resolveReady(currentUser);

          // Important: many modules read localStorage during initial load.
          // If they ran before we restored the session, they may have read from the anonymous namespace.
          // Reload when the restored user changes so everything re-initializes with the correct user.
          try {
            const lastUserKey = 'tmr_last_user_id';
            if (typeof sessionStorage !== 'undefined') {
              const last = sessionStorage.getItem(lastUserKey);
              const now = String(currentUser.id);
              if (last !== now) {
                sessionStorage.setItem(lastUserKey, now);
                setTimeout(() => { try { window.location.reload(); } catch (e) {} }, 10);
                return true;
              }
            }
          } catch (e) {}

          return true;
        }
      }
    } catch (err) {
      console.error('[Auth] Init error:', err.message);
    }

    // No session found - show login UI
    resolveReady(null);
    // Only clear the boot snapshot if the server explicitly says there's no session.
    // If the server is down / network hiccup, keep it so pages don't flash defaults.
    try { if (sessionExplicitlyMissing) clearBootThemeSnapshot(); } catch (e) {}
    showLoginUI();
    return false;
  };

  /**
   * Register a new user
   */
  const register = async (username, password) => {
    if (!username || username.trim().length < 3) {
      throw new Error('Username must be at least 3 characters');
    }
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    try {
      const response = await fetch('/auth/register', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error === 'username_taken' ? 'Username already taken' : 'Registration failed');
      }

      const data = await response.json();
      currentUser = data.user;
      console.log('[Auth] Registered and logged in as:', currentUser.username);
      resolveReady(currentUser);
      try { migrateAnonDataToUserScope(currentUser.id); } catch (e) {}
      clearAllCaches();
      try { updateBootThemeSnapshot(); } catch (e) {}
      showLoggedInUI();
      try { window.dispatchEvent(new CustomEvent('tmr:auth-changed', { detail: { user: currentUser } })); } catch (e) {}
      setTimeout(() => { try { window.location.reload(); } catch (e) {} }, 50);
      return data.user;
    } catch (err) {
      console.error('[Auth] Register error:', err.message);
      throw err;
    }
  };

  /**
   * Login with username and password
   */
  const login = async (username, password) => {
    if (!username || !password) {
      throw new Error('Username and password required');
    }

    try {
      const response = await fetch('/auth/login', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error === 'invalid_credentials' ? 'Invalid username or password' : 'Login failed');
      }

      const data = await response.json();
      currentUser = data.user;
      console.log('[Auth] Logged in as:', currentUser.username);
      resolveReady(currentUser);
      try { migrateAnonDataToUserScope(currentUser.id); } catch (e) {}
      clearAllCaches();
      try { updateBootThemeSnapshot(); } catch (e) {}
      showLoggedInUI();
      try { window.dispatchEvent(new CustomEvent('tmr:auth-changed', { detail: { user: currentUser } })); } catch (e) {}
      setTimeout(() => { try { window.location.reload(); } catch (e) {} }, 50);
      return data.user;
    } catch (err) {
      console.error('[Auth] Login error:', err.message);
      throw err;
    }
  };

  /**
   * Logout current user
   */
  const logout = async () => {
    // Best-effort: if user connected Google Calendar, sync before ending the session.
    await tryGoogleCalendarSyncBeforeLogout();

    try {
      await fetch('/auth/logout', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.error('[Auth] Logout fetch error:', err.message);
    }

    currentUser = null;
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('tmr_last_user_id'); } catch (e) {}
    try { clearBootThemeSnapshot(); } catch (e) {}
    clearAllCaches();
    showLoginUI();
    console.log('[Auth] Logged out');
    try { window.dispatchEvent(new CustomEvent('tmr:auth-changed', { detail: { user: null } })); } catch (e) {}
    setTimeout(() => { try { window.location.reload(); } catch (e) {} }, 50);
  };

  /**
   * Logout all sessions
   */
  const logoutAll = async () => {
    // Best-effort: if user connected Google Calendar, sync before ending the session(s).
    await tryGoogleCalendarSyncBeforeLogout();

    try {
      const response = await fetch('/auth/logout-all', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Logout all failed');
      }
    } catch (err) {
      console.error('[Auth] Logout all error:', err.message);
    }

    currentUser = null;
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('tmr_last_user_id'); } catch (e) {}
    try { clearBootThemeSnapshot(); } catch (e) {}
    clearAllCaches();
    showLoginUI();
    console.log('[Auth] Logged out from all sessions');
    try { window.dispatchEvent(new CustomEvent('tmr:auth-changed', { detail: { user: null } })); } catch (e) {}
    setTimeout(() => { try { window.location.reload(); } catch (e) {} }, 50);
  };

  /**
   * Get current user
   */
  const getCurrentUser = () => currentUser;

  /**
   * Get user ID for caching and API calls
   */
  const getUserId = () => currentUser ? currentUser.id : null;

  /**
   * Clear all per-user caches when user changes
   */
  const clearAllCaches = () => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const backend = window.localStorage;
    // Iterate using raw key access to avoid scoping transformations.
    for (let i = backend.length - 1; i >= 0; i--) {
      const key = rawKeyAt(i);
      if (!key) continue;
      // Only clear *unscoped* legacy keys like "tmr_events" and "tmr_anon_*".
      // Never delete per-user data keys like "tmr_user_123_*".
      if (key.startsWith(CACHE_PREFIX) && !key.startsWith(`${CACHE_PREFIX}user_`)) {
        rawRemoveItem(key);
      }
    }
    console.log('[Auth] Cleared all user caches');
  };

  /**
   * Build per-user cache key
   */
  const getCacheKey = (base) => {
    const uid = getUserId();
    // When not authenticated yet, never use a shared unscoped key namespace.
    // This prevents a previous user's cached data from briefly showing during startup
    // before /auth/session completes.
    return uid ? `${CACHE_PREFIX}user_${uid}_${base}` : `${CACHE_PREFIX}anon_${base}`;
  };

  const installScopedLocalStoragePatch = () => {
    if (typeof window === 'undefined') return;
    if (window[SCOPED_PATCH_INSTALLED_KEY]) return;
    if (typeof Storage === 'undefined' || !Storage || !Storage.prototype) return;

    const rawFns = getRawLocalStorageFns();
    if (!rawFns || !rawFns.getItem || !rawFns.setItem || !rawFns.removeItem || !rawFns.key) return;

    const GLOBAL_UNSCOPED_KEYS = new Set([
      // Device-wide flags / status keys used across pages (intro.html doesn't load auth-client.js)
      'tmr_tutorial_seen',
      // Google Calendar client status bookkeeping (not user content)
      'tmr_gcal_status',
      'last_gcal_sync',
      // UI boot snapshot to prevent theme flash between pages
      BOOT_THEME_KEY
    ]);

    const isGlobalUnscoped = (key) => {
      return typeof key === 'string' && GLOBAL_UNSCOPED_KEYS.has(key);
    };

    const isAlreadyScoped = (key) => {
      if (typeof key !== 'string') return false;
      return key.startsWith(`${CACHE_PREFIX}user_`) || key.startsWith(`${CACHE_PREFIX}anon_`);
    };

    Storage.prototype.getItem = function(key) {
      if (this === window.localStorage && typeof key === 'string' && isGlobalUnscoped(key)) {
        return rawFns.getItem.call(this, key);
      }
      if (this === window.localStorage && typeof key === 'string' && !isAlreadyScoped(key)) {
        return rawFns.getItem.call(this, getCacheKey(key));
      }
      return rawFns.getItem.call(this, key);
    };

    Storage.prototype.setItem = function(key, value) {
      if (this === window.localStorage && typeof key === 'string' && isGlobalUnscoped(key)) {
        return rawFns.setItem.call(this, key, value);
      }
      if (this === window.localStorage && typeof key === 'string' && !isAlreadyScoped(key)) {
        return rawFns.setItem.call(this, getCacheKey(key), value);
      }
      return rawFns.setItem.call(this, key, value);
    };

    Storage.prototype.removeItem = function(key) {
      if (this === window.localStorage && typeof key === 'string' && isGlobalUnscoped(key)) {
        return rawFns.removeItem.call(this, key);
      }
      if (this === window.localStorage && typeof key === 'string' && !isAlreadyScoped(key)) {
        return rawFns.removeItem.call(this, getCacheKey(key));
      }
      return rawFns.removeItem.call(this, key);
    };

    // Keep indexed access raw.
    Storage.prototype.key = function(index) {
      return rawFns.key.call(this, index);
    };

    window[SCOPED_PATCH_INSTALLED_KEY] = true;
    console.log('[Auth] Installed scoped localStorage patch');
  };

  // Install immediately so all modules use per-user storage.
  try { installScopedLocalStoragePatch(); } catch (e) {}

  const updateBootThemeSnapshot = () => {
    try {
      const accentColor = localStorage.getItem('theme_accent_color') || localStorage.getItem('tmr_accent') || null;
      const backgroundImage = localStorage.getItem('theme_bg_image') || localStorage.getItem('tmr_bg_image') || null;
      const animation = localStorage.getItem('theme_animation') || null;

      let accentRgb = null;
      if (typeof accentColor === 'string') {
        let hex = accentColor.trim();
        if (hex.startsWith('#')) hex = hex.slice(1);
        if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
          const r = parseInt(hex.slice(0, 2), 16);
          const g = parseInt(hex.slice(2, 4), 16);
          const b = parseInt(hex.slice(4, 6), 16);
          accentRgb = `${r},${g},${b}`;
        }
      }

      localStorage.setItem(BOOT_THEME_KEY, JSON.stringify({
        accentColor,
        accentRgb,
        backgroundImage,
        animation,
        updatedAt: Date.now()
      }));
    } catch (e) {}
  };

  const clearBootThemeSnapshot = () => {
    try { localStorage.removeItem(BOOT_THEME_KEY); } catch (e) {}
  };

  /**
   * Wrapped localStorage that uses per-user keys
   */
  const storage = {
    getItem: (key) => {
      return rawGetItem(getCacheKey(key));
    },
    setItem: (key, value) => {
      rawSetItem(getCacheKey(key), value);
    },
    removeItem: (key) => {
      rawRemoveItem(getCacheKey(key));
    },
    clear: () => {
      clearAllCaches();
    }
  };

  /**
   * Show login UI (hide app, show login modal)
   */
  const showLoginUI = () => {
    const authModal = document.getElementById('auth-modal-backdrop');
    const appContainer = document.querySelector('.calendar-page');
    const header = document.querySelector('.page-header');
    const headerLoginBtn = document.getElementById('header-login-btn');

    // Keep the app visible; the auth modal is an overlay.
    // This prevents the "only header remains" blank state if something goes wrong.
    if (appContainer) appContainer.style.setProperty('display', 'flex', 'important');
    if (header) header.style.setProperty('display', 'flex', 'important');
    if (headerLoginBtn) headerLoginBtn.style.display = 'inline-block';

    if (!authModal) {
      console.error('[Auth] Cannot show login UI: #auth-modal-backdrop not found');
      return;
    }

    // Defensive: if the modal was moved into a hidden container or detached,
    // it can end up with a 0x0 rect even though its own display is "flex".
    try {
      if (!authModal.isConnected) {
        console.warn('[Auth] Auth modal was detached; re-attaching to document.body');
        document.body.appendChild(authModal);
      }
      authModal.hidden = false;
      authModal.removeAttribute('hidden');
    } catch (_) {
      // ignore
    }

    // Force-show modal with strong overrides.
    authModal.style.setProperty('display', 'flex', 'important');
    authModal.style.setProperty('visibility', 'visible', 'important');
    authModal.style.setProperty('opacity', '1', 'important');
    // Stay above other in-app modals (themes/gcal use 10000).
    authModal.style.setProperty('z-index', '2147483647', 'important');
    authModal.style.setProperty('position', 'fixed', 'important');
    authModal.style.setProperty('top', '0', 'important');
    authModal.style.setProperty('right', '0', 'important');
    authModal.style.setProperty('bottom', '0', 'important');
    authModal.style.setProperty('left', '0', 'important');
    authModal.style.setProperty('width', '100vw', 'important');
    authModal.style.setProperty('height', '100vh', 'important');
    // Re-apply background in case another stylesheet overrides it.
    authModal.style.setProperty('background', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 'important');
    authModal.style.setProperty('pointer-events', 'auto', 'important');

    const loginForm = document.getElementById('auth-login-form');
    const registerForm = document.getElementById('auth-register-form');
    if (loginForm) loginForm.style.display = 'block';
    if (registerForm) registerForm.style.display = 'none';

    const modalDisplay = window.getComputedStyle(authModal).display;
    const modalVisibility = window.getComputedStyle(authModal).visibility;
    const modalOpacity = window.getComputedStyle(authModal).opacity;

    const rect = authModal.getBoundingClientRect();

    let hiddenAncestor = null;
    if (rect.width === 0 && rect.height === 0) {
      let el = authModal;
      while (el) {
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') {
          hiddenAncestor = {
            tag: el.tagName,
            id: el.id || null,
            className: el.className ? String(el.className) : null,
            display: cs.display,
            visibility: cs.visibility,
            position: cs.position,
            zIndex: cs.zIndex
          };
          break;
        }
        el = el.parentElement;
      }
    }
    const cx = Math.floor(window.innerWidth / 2);
    const cy = Math.floor(window.innerHeight / 2);
    const topEl = document.elementFromPoint(cx, cy);
    const describeEl = (el) => {
      if (!el) return null;
      const id = el.id ? `#${el.id}` : '';
      const cls = el.className ? `.${String(el.className).trim().split(/\s+/).slice(0, 3).join('.')}` : '';
      const z = window.getComputedStyle(el).zIndex;
      const pos = window.getComputedStyle(el).position;
      return `${el.tagName}${id}${cls} (pos:${pos} z:${z})`;
    };

    console.log('[Auth] Login UI shown', {
      authModal: true,
      appContainer: !!appContainer,
      header: !!header,
      modalDisplay,
      modalVisibility,
      modalOpacity,
      modalRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      elementFromPointCenter: describeEl(topEl),
      hiddenAncestor
    });
  };

  /**
   * Show logged-in UI (show app, hide login modal)
   */
  const showLoggedInUI = () => {
    const authModal = document.getElementById('auth-modal-backdrop');
    const appContainer = document.querySelector('.calendar-page');
    const header = document.querySelector('.page-header');
    const headerLoginBtn = document.getElementById('header-login-btn');

    if (authModal) {
      authModal.style.setProperty('display', 'none', 'important');
      authModal.style.setProperty('visibility', 'hidden', 'important');
      authModal.style.setProperty('opacity', '0', 'important');
      authModal.style.setProperty('z-index', '-1', 'important');
    }
    if (appContainer) appContainer.style.setProperty('display', 'flex', 'important');
    if (header) header.style.setProperty('display', 'flex', 'important');
    if (headerLoginBtn) headerLoginBtn.style.display = 'none';  // Hide login button when logged in

    console.log('[Auth] App UI shown');
  };

  /**
   * Toggle between login and register forms
   */
  const toggleAuthForm = (toRegister = null) => {
    const loginForm = document.getElementById('auth-login-form');
    const registerForm = document.getElementById('auth-register-form');

    if (toRegister === null) {
      // Toggle
      const showReg = loginForm && loginForm.style.display === 'block';
      if (loginForm) loginForm.style.display = showReg ? 'none' : 'block';
      if (registerForm) registerForm.style.display = showReg ? 'block' : 'none';
    } else {
      // Set explicitly
      if (loginForm) loginForm.style.display = toRegister ? 'none' : 'block';
      if (registerForm) registerForm.style.display = toRegister ? 'block' : 'none';
    }
  };

  /**
   * Attach event listeners to auth modal
   */
  const attachEventListeners = () => {
    console.log('[Auth] Attaching event listeners...');
    
    // Header login button - shows auth modal
    const headerLoginBtn = document.getElementById('header-login-btn');
    if (headerLoginBtn) {
      console.log('[Auth] Found header login button, attaching click handler');
      headerLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('[Auth] Header login button clicked, showing auth modal');
        showLoginUI();
      });
    } else {
      console.warn('[Auth] Header login button not found!');
    }
    
    // Login form submission
    const loginForm = document.getElementById('auth-login-form');
    if (loginForm) {
      console.log('[Auth] Found login form, attaching submit handler');
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('auth-login-username').value;
        const password = document.getElementById('auth-login-password').value;
        const errorDiv = document.getElementById('auth-login-error');

        console.log('[Auth] Login form submitted:', { username, passwordLength: password.length });

        try {
          if (errorDiv) errorDiv.textContent = '';
          await login(username, password);
        } catch (err) {
          console.error('[Auth] Login error:', err.message);
          if (errorDiv) errorDiv.textContent = err.message;
        }
      });
    } else {
      console.warn('[Auth] Login form not found!');
    }

    // Register form submission
    const registerForm = document.getElementById('auth-register-form');
    if (registerForm) {
      console.log('[Auth] Found register form, attaching submit handler');
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('auth-register-username').value;
        const password = document.getElementById('auth-register-password').value;
        const confirmPassword = document.getElementById('auth-register-confirm-password').value;
        const errorDiv = document.getElementById('auth-register-error');

        console.log('[Auth] Register form submitted:', { username, passwordLength: password.length });

        try {
          if (errorDiv) errorDiv.textContent = '';

          if (password !== confirmPassword) {
            throw new Error('Passwords do not match');
          }

          await register(username, password);
        } catch (err) {
          console.error('[Auth] Register error:', err.message);
          if (errorDiv) errorDiv.textContent = err.message;
        }
      });
    } else {
      console.warn('[Auth] Register form not found!');
    }

    // Toggle links
    const toRegisterLink = document.getElementById('auth-to-register-link');
    const toLoginLink = document.getElementById('auth-to-login-link');

    if (toRegisterLink) {
      console.log('[Auth] Found register toggle link');
      toRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('[Auth] Switching to register form');
        toggleAuthForm(true);
      });
    }

    if (toLoginLink) {
      console.log('[Auth] Found login toggle link');
      toLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('[Auth] Switching to login form');
        toggleAuthForm(false);
      });
    }

    // Logout button in header
    const logoutBtn = document.getElementById('header-logout-btn');
    if (logoutBtn) {
      console.log('[Auth] Found logout button');
      logoutBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to logout?')) {
          await logout();
        }
      });
    }

    // Logout all button
    const logoutAllBtn = document.getElementById('header-logout-all-btn');
    if (logoutAllBtn) {
      console.log('[Auth] Found logout-all button');
      logoutAllBtn.addEventListener('click', async () => {
        if (confirm('Logout from all devices?')) {
          await logoutAll();
        }
      });
    }

    console.log('[Auth] Event listeners attached');
  };

  return {
    init,
    register,
    login,
    logout,
    logoutAll,
    getCurrentUser,
    getUserId,
    getCacheKey,
    ready,
    storage,
    clearAllCaches,
    toggleAuthForm,
    attachEventListeners,
    showLoginUI,
    showLoggedInUI
  };
})();

// Install key scoping immediately so all subsequent scripts see per-user storage.
try {
  if (typeof AuthClient !== 'undefined' && AuthClient && typeof AuthClient.getCacheKey === 'function') {
    // Accessing any method will load the IIFE; patch is installed below via the closure.
  }
} catch (e) {}

// Initialize auth when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => AuthClient.init());
} else {
  AuthClient.init();
}
