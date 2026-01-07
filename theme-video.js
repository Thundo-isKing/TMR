// Background video ("live wallpaper") support using IndexedDB for persistence.
// Exposes window.TMRThemeVideo with methods used by TMR.js and other pages.

(function () {
    'use strict';

    const DB_NAME = 'tmr_theme_assets_v1';
    const STORE_NAME = 'bgVideos';

    let dbPromise = null;
    let currentObjectUrl = null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME);
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
            } catch (e) {
                reject(e);
            }
        });
        return dbPromise;
    }

    async function putBlob(key, blob) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(blob, key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error || new Error('Failed to store video'));
        });
    }

    async function getBlob(key) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error || new Error('Failed to read video'));
        });
    }

    async function deleteBlob(key) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error || new Error('Failed to delete video'));
        });
    }

    function getLastUserIdSafe() {
        try {
            return (typeof sessionStorage !== 'undefined') ? sessionStorage.getItem('tmr_last_user_id') : null;
        } catch (_) {
            return null;
        }
    }

    function resolveVideoIdFromStorage() {
        try {
            const lastUid = getLastUserIdSafe();
            if (lastUid) {
                const u = localStorage.getItem('tmr_user_' + lastUid + '_theme_bg_video');
                if (u) return u;
            }

            const a = localStorage.getItem('tmr_anon_theme_bg_video');
            if (a) return a;

            const direct = localStorage.getItem('theme_bg_video');
            if (direct) return direct;

            const raw = localStorage.getItem('tmr_boot_theme');
            if (raw) {
                const boot = JSON.parse(raw);
                if (boot && typeof boot === 'object' && typeof boot.backgroundVideo === 'string' && boot.backgroundVideo) {
                    return boot.backgroundVideo;
                }
            }
        } catch (_) {}
        return null;
    }

    function ensureVideoElement() {
        let el = document.getElementById('tmr-bg-video');
        if (el) return el;

        el = document.createElement('video');
        el.id = 'tmr-bg-video';
        el.className = 'tmr-bg-video';
        el.muted = true;
        el.loop = true;
        el.autoplay = true;
        el.playsInline = true;
        el.preload = 'auto';
        el.setAttribute('muted', '');
        el.setAttribute('loop', '');
        el.setAttribute('autoplay', '');
        el.setAttribute('playsinline', '');
        el.style.display = 'none';

        // Put it at the top so it stays behind everything.
        if (document.body && document.body.firstChild) {
            document.body.insertBefore(el, document.body.firstChild);
        } else if (document.body) {
            document.body.appendChild(el);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                try {
                    if (document.body) document.body.insertBefore(el, document.body.firstChild);
                } catch (_) {}
            });
        }

        return el;
    }

    function setHasVideoFlag(isOn) {
        try {
            if (isOn) document.documentElement.classList.add('tmr-has-bg-video');
            else document.documentElement.classList.remove('tmr-has-bg-video');
        } catch (_) {}
    }

    function hideVideo(el) {
        try {
            if (currentObjectUrl) {
                try { URL.revokeObjectURL(currentObjectUrl); } catch (_) {}
                currentObjectUrl = null;
            }
            el.removeAttribute('src');
            try { el.load(); } catch (_) {}
            el.style.display = 'none';
        } catch (_) {}
        setHasVideoFlag(false);
    }

    async function applyFromStorage() {
        const id = resolveVideoIdFromStorage();
        const el = ensureVideoElement();

        if (!id) {
            hideVideo(el);
            return null;
        }

        try {
            const blob = await getBlob(id);
            if (!blob) {
                hideVideo(el);
                return null;
            }

            if (currentObjectUrl) {
                try { URL.revokeObjectURL(currentObjectUrl); } catch (_) {}
                currentObjectUrl = null;
            }

            const url = URL.createObjectURL(blob);
            currentObjectUrl = url;
            el.src = url;
            el.style.display = 'block';
            setHasVideoFlag(true);

            try {
                const p = el.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            } catch (_) {}

            return id;
        } catch (e) {
            console.warn('[ThemeVideo] Failed to apply background video:', e);
            hideVideo(el);
            return null;
        }
    }

    function updateBootThemeSnapshot(patch) {
        try {
            const raw = localStorage.getItem('tmr_boot_theme');
            const theme = raw ? (JSON.parse(raw) || {}) : {};
            const updated = Object.assign({}, theme, patch, { updatedAt: Date.now() });
            localStorage.setItem('tmr_boot_theme', JSON.stringify(updated));
        } catch (_) {}
    }

    function syncThemeKeyAcrossNamespaces(keySuffix, value) {
        try {
            const lastUid = getLastUserIdSafe();
            if (lastUid) {
                localStorage.setItem('tmr_user_' + lastUid + '_' + keySuffix, value);
            } else {
                localStorage.setItem('tmr_anon_' + keySuffix, value);
            }
        } catch (_) {}
    }

    async function saveFromFile(file) {
        if (!file) throw new Error('No file provided');
        if (!/^video\//i.test(file.type || '')) {
            throw new Error('Not a video file');
        }

        // Keep a practical limit; videos are large and IndexedDB quotas vary.
        const maxBytes = 25 * 1024 * 1024; // 25MB
        if (typeof file.size === 'number' && file.size > maxBytes) {
            throw new Error('Video too large (max 25MB)');
        }

        const id = 'bgv_' + Date.now() + '_' + Math.random().toString(16).slice(2);
        await putBlob(id, file);

        // Store the ID in both the theme key and the scoped theme key so other pages can find it.
        try { localStorage.setItem('theme_bg_video', id); } catch (_) {}
        syncThemeKeyAcrossNamespaces('theme_bg_video', id);
        updateBootThemeSnapshot({ backgroundVideo: id });

        return id;
    }

    async function clear() {
        const prev = resolveVideoIdFromStorage();

        try { localStorage.removeItem('theme_bg_video'); } catch (_) {}
        try { syncThemeKeyAcrossNamespaces('theme_bg_video', ''); } catch (_) {}
        updateBootThemeSnapshot({ backgroundVideo: null });

        if (prev) {
            try { await deleteBlob(prev); } catch (_) {}
        }

        hideVideo(ensureVideoElement());
    }

    function getCurrentObjectUrl() {
        return currentObjectUrl;
    }

    window.TMRThemeVideo = {
        applyFromStorage,
        saveFromFile,
        clear,
        getCurrentId: resolveVideoIdFromStorage,
        getCurrentObjectUrl
    };

    // Auto-apply once the DOM is ready.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applyFromStorage().catch(() => {});
        });
    } else {
        applyFromStorage().catch(() => {});
    }
})();
