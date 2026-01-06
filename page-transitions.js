/* Page navigation fade-out on same-origin link clicks.
   Keep this conservative to avoid breaking auth flows or app logic.
*/

(function () {
    "use strict";

    function shouldHandleLinkClick(event, anchor) {
        if (!anchor) return false;

        // Respect modifier keys/new tab behaviors.
        if (event.defaultPrevented) return false;
        if (event.button !== 0) return false; // left click only
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

        var target = (anchor.getAttribute('target') || '').toLowerCase();
        if (target && target !== '_self') return false;
        if (anchor.hasAttribute('download')) return false;
        if (anchor.getAttribute('data-no-page-fade') != null) return false;

        var href = anchor.getAttribute('href');
        if (!href) return false;
        if (href[0] === '#') return false;

        // Ignore javascript: and mailto: etc.
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) && !/^https?:/i.test(href)) return false;

        try {
            var url = new URL(href, window.location.href);
            if (url.origin !== window.location.origin) return false;

            // Same-document hash change -> no fade.
            if (url.pathname === window.location.pathname && url.search === window.location.search) {
                if (url.hash) return false;
            }

            return true;
        } catch (e) {
            return false;
        }
    }

    function startFadeOutThenNavigate(url) {
        try { document.documentElement.classList.add('tmr-page-fade-out'); } catch (e) {}
        window.setTimeout(function () {
            window.location.href = url;
        }, 140);
    }

    document.addEventListener('click', function (event) {
        var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
        if (!shouldHandleLinkClick(event, anchor)) return;

        event.preventDefault();

        var url = new URL(anchor.getAttribute('href'), window.location.href);
        startFadeOutThenNavigate(url.href);
    }, true);

    // If navigation happens via code/reload, still attempt a quick fade.
    window.addEventListener('beforeunload', function () {
        try { document.documentElement.classList.add('tmr-page-fade-out'); } catch (e) {}
    });

    // bfcache restore: ensure we don't stay faded out.
    window.addEventListener('pageshow', function () {
        try { document.documentElement.classList.remove('tmr-page-fade-out'); } catch (e) {}
    });
})();
