/**
 * Button Shadow Handler
 * Separates shadows from button transforms so shadows stay fixed while buttons move
 */

(function() {
    'use strict';

    // Configuration for different button types
    const buttonConfig = {
        '.tmr-btn': {
            shadowSize: '15px',
            shadowColor: 'rgba(128, 128, 128, 0.674)',
            exclude: ['.small-tmr-btn', '.nav-btn']
        },
        '.small-tmr-btn': {
            shadowSize: '8px',
            shadowColor: 'rgba(128, 128, 128, 0.5)',
            exclude: ['.nav-btn']
        },
        '.calendar-day': {
            shadowSize: '10px',
            shadowColor: 'rgba(80, 80, 80, 0.18)'
        }
    };

    function shouldExclude(element, excludeClasses) {
        if (!excludeClasses) return false;
        return excludeClasses.some(cls => element.classList.contains(cls.replace('.', '')));
    }

    function createShadowElement(button, config) {
        // Create container wrapper
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.display = 'inline-block';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';

        // Create shadow element
        const shadow = document.createElement('div');
        shadow.className = 'button-shadow';
        shadow.style.position = 'absolute';
        shadow.style.width = '100%';
        shadow.style.height = '100%';
        shadow.style.backgroundColor = config.shadowColor;
        shadow.style.borderRadius = window.getComputedStyle(button).borderRadius;
        shadow.style.bottom = `-${config.shadowSize}`;
        shadow.style.right = `-${config.shadowSize}`;
        shadow.style.pointerEvents = 'none';
        shadow.style.zIndex = '-1';

        // Insert shadow into wrapper
        wrapper.appendChild(shadow);

        // Move button into wrapper (button becomes first child for stacking)
        wrapper.insertBefore(button.cloneNode(true), shadow);
        button.replaceWith(wrapper);

        return wrapper.firstChild; // Return the cloned button element
    }

    function initializeButtonShadows() {
        Object.entries(buttonConfig).forEach(([selector, config]) => {
            const buttons = document.querySelectorAll(selector);
            
            buttons.forEach(button => {
                // Skip if it matches exclude patterns
                if (shouldExclude(button, config.exclude)) {
                    return;
                }

                // Skip if already processed
                if (button.parentElement && button.parentElement.className === 'button-shadow-wrapper') {
                    return;
                }

                // Skip nav buttons - they should have no shadow
                if (button.classList.contains('nav-btn')) {
                    return;
                }

                // Create shadow wrapper
                const wrapper = document.createElement('div');
                wrapper.className = 'button-shadow-wrapper';
                wrapper.style.position = 'relative';
                wrapper.style.display = button.style.display || 'inline-block';

                // Create shadow element
                const shadow = document.createElement('div');
                shadow.className = 'button-shadow';
                shadow.style.position = 'absolute';
                shadow.style.width = '100%';
                shadow.style.height = '100%';
                shadow.style.backgroundColor = config.shadowColor;
                shadow.style.borderRadius = window.getComputedStyle(button).borderRadius;
                shadow.style.bottom = `-${config.shadowSize}`;
                shadow.style.right = `-${config.shadowSize}`;
                shadow.style.pointerEvents = 'none';
                shadow.style.zIndex = '-1';

                // Insert button into wrapper
                button.parentNode.insertBefore(wrapper, button);
                wrapper.appendChild(button);
                wrapper.appendChild(shadow);

                // Remove box-shadow from button
                button.style.boxShadow = 'none !important';
            });
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeButtonShadows);
    } else {
        initializeButtonShadows();
    }

    // Re-initialize after dynamic content loads
    const observer = new MutationObserver(() => {
        initializeButtonShadows();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
