/* Themes Module - Handles accent color, background color/image, and animations */
(function() {
    // Storage keys
    const STORAGE_KEY_ACCENT = 'theme_accent_color';
    const STORAGE_KEY_BG_COLOR = 'theme_bg_color';
    const STORAGE_KEY_BG_IMAGE = 'theme_bg_image';
    const STORAGE_KEY_ANIMATION = 'theme_animation';

    // Clean up any bad localStorage values on load
    const validAnimations = ['none', 'particles', 'gradient-flow', 'wave-pulse', 'triangles', ''];
    const storedAnimation = localStorage.getItem(STORAGE_KEY_ANIMATION);
    if (storedAnimation && !validAnimations.includes(storedAnimation)) {
        console.warn('[Themes] Invalid animation in localStorage:', storedAnimation, '- resetting to none');
        localStorage.setItem(STORAGE_KEY_ANIMATION, 'none');
    }

    // Also check if animation is stored as 'none' - if so, don't actually store it
    if (storedAnimation === 'none') {
        console.log('[Themes] Animation is "none", clearing from storage');
        localStorage.removeItem(STORAGE_KEY_ANIMATION);
    }

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        // Get all elements
        const headerThemesBtn = document.getElementById('header-themes-btn');
        const themeModal = document.getElementById('themes-modal-backdrop');
        
        console.log('[Themes] Initializing...');
        console.log('[Themes] Current body classes:', document.body.className);
        console.log('[Themes] headerThemesBtn:', headerThemesBtn);
        console.log('[Themes] themeModal:', themeModal);
        
        if (!headerThemesBtn || !themeModal) {
            console.error('[Themes] Modal elements not found!');
            console.error('[Themes] headerThemesBtn:', headerThemesBtn ? 'FOUND' : 'MISSING');
            console.error('[Themes] themeModal:', themeModal ? 'FOUND' : 'MISSING');
            return;
        }

        // Clear any custom animation classes that shouldn't be there
        document.body.classList.remove('theme-particles', 'theme-gradient-flow', 'theme-wave-pulse', 'theme-triangles');
        console.log('[Themes] Cleared custom animation classes');

        // Get control elements
        const accentInput = document.getElementById('themes-accent-picker');
        const bgColorInput = document.getElementById('themes-bg-picker');
        const bgImageInput = document.getElementById('themes-bg-upload');
        const animationSelect = document.getElementById('themes-animation-select');
        
        const accentPreview = document.getElementById('themes-accent-preview');
        const bgColorPreview = document.getElementById('themes-bg-preview');
        const bgImagePreview = document.querySelector('.themes-bg-preview');
        const bgImagePreviewImg = document.getElementById('themes-bg-img');
        const bgImagePreviewText = document.getElementById('themes-bg-preview-text');
        const bgImageNoneBtn = document.getElementById('themes-bg-none-btn');
        
        const closeBtn = document.getElementById('themes-modal-close');
        const cancelBtn = document.getElementById('themes-cancel-btn');
        const saveBtn = document.getElementById('themes-save-btn');

        // Current state - validate animation value
        let animation = localStorage.getItem(STORAGE_KEY_ANIMATION) || 'none';
        if (!['none', 'particles', 'gradient-flow', 'wave-pulse', 'triangles'].includes(animation)) {
            animation = 'none'; // Reset if invalid
        }

        let currentTheme = {
            accent: localStorage.getItem(STORAGE_KEY_ACCENT) || '#0089f1',
            bgColor: localStorage.getItem(STORAGE_KEY_BG_COLOR) || '#ffffff',
            bgImage: localStorage.getItem(STORAGE_KEY_BG_IMAGE) || null,
            animation: animation
        };

        console.log('[Themes] Current theme loaded:', currentTheme);

        function refreshThemeFromLocalStorage() {
            let animation = localStorage.getItem(STORAGE_KEY_ANIMATION) || 'none';
            if (!['none', 'particles', 'gradient-flow', 'wave-pulse', 'triangles'].includes(animation)) {
                animation = 'none';
            }

            currentTheme = {
                accent: localStorage.getItem(STORAGE_KEY_ACCENT) || '#0089f1',
                bgColor: localStorage.getItem(STORAGE_KEY_BG_COLOR) || '#ffffff',
                bgImage: localStorage.getItem(STORAGE_KEY_BG_IMAGE) || null,
                animation: animation
            };

            const hasCustomTheme =
                localStorage.getItem(STORAGE_KEY_ACCENT) !== null ||
                localStorage.getItem(STORAGE_KEY_BG_COLOR) !== null ||
                localStorage.getItem(STORAGE_KEY_ANIMATION) !== null ||
                localStorage.getItem(STORAGE_KEY_BG_IMAGE) !== null;

            if (hasCustomTheme) {
                applyTheme(currentTheme);
            }
        }

        // Load theme from server on startup
        async function loadThemeFromServer() {
            try {
                const response = await fetch(`/theme/load`, { credentials: 'include' });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.theme) {
                        console.log('[Themes] ✓ Loaded theme from server:', data.theme);
                        
                        // Update current theme with server values
                        if (data.theme.accentColor) {
                            currentTheme.accent = data.theme.accentColor;
                            localStorage.setItem(STORAGE_KEY_ACCENT, data.theme.accentColor);
                        }
                        if (data.theme.backgroundImage) {
                            currentTheme.bgImage = data.theme.backgroundImage;
                            localStorage.setItem(STORAGE_KEY_BG_IMAGE, data.theme.backgroundImage);
                        }
                        if (data.theme.animation) {
                            currentTheme.animation = data.theme.animation;
                            localStorage.setItem(STORAGE_KEY_ANIMATION, data.theme.animation);
                        }
                        
                        // Apply the loaded theme
                        applyTheme(currentTheme);
                    }
                } else {
                    console.debug('[Themes] No theme found on server (first time or server unavailable)');
                }
            } catch (err) {
                console.debug('[Themes] Could not load theme from server:', err.message);
                // Continue with localStorage theme
            }
        }

        // Load theme from server
        loadThemeFromServer();

        // Apply stored theme on init (per-user via localStorage proxy)
        refreshThemeFromLocalStorage();

        // When account changes/restores, reload theme from server and re-apply from local storage.
        window.addEventListener('tmr:auth-changed', () => {
            refreshThemeFromLocalStorage();
            loadThemeFromServer();
        });

        // Modal control
        function openModal() {
            console.log('[Themes] openModal called');
            accentInput.value = currentTheme.accent;
            bgColorInput.value = currentTheme.bgColor;
            animationSelect.value = currentTheme.animation;
            
            // Reset file input for fresh selection
            bgImageInput.value = '';
            
            updatePreviews();
            showBgImagePreview();
            
            console.log('[Themes] Setting modal display to flex');
            themeModal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }

        function closeModal() {
            themeModal.style.display = 'none';
            document.body.style.overflow = '';
        }

        // Preview updates
        function updatePreviews() {
            if (accentPreview) {
                accentPreview.style.backgroundColor = accentInput.value;
            }
            if (bgColorPreview) {
                bgColorPreview.style.backgroundColor = bgColorInput.value;
            }
        }

        function showBgImagePreview() {
            console.log('[Themes] Updating image preview. currentTheme.bgImage:', currentTheme.bgImage ? 'EXISTS' : 'NULL');
            if (currentTheme.bgImage) {
                console.log('[Themes] Showing image preview');
                bgImagePreviewImg.src = currentTheme.bgImage;
                bgImagePreview.style.display = 'block';
                bgImagePreviewText.style.display = 'none';
            } else {
                console.log('[Themes] Hiding image preview');
                bgImagePreview.style.display = 'none';
                bgImagePreviewText.style.display = 'block';
            }
        }

        // Save theme
        async function saveTheme() {
            currentTheme = {
                accent: accentInput.value,
                bgColor: bgColorInput.value,
                bgImage: currentTheme.bgImage,
                animation: animationSelect.value
            };

            // Save to localStorage
            localStorage.setItem(STORAGE_KEY_ACCENT, currentTheme.accent);
            localStorage.setItem(STORAGE_KEY_BG_COLOR, currentTheme.bgColor);
            if (currentTheme.bgImage) {
                localStorage.setItem(STORAGE_KEY_BG_IMAGE, currentTheme.bgImage);
            } else {
                localStorage.removeItem(STORAGE_KEY_BG_IMAGE);
            }
            localStorage.setItem(STORAGE_KEY_ANIMATION, currentTheme.animation);

            // Apply theme
            applyTheme(currentTheme);

            // Save to server
            try {
                const response = await fetch('/theme/save', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        theme: {
                            accentColor: currentTheme.accent,
                            backgroundImage: currentTheme.bgImage,
                            animation: currentTheme.animation
                        }
                    })
                });
                
                if (response.ok) {
                    console.log('[Themes] ✓ Theme saved to server');
                } else {
                    console.warn('[Themes] Server save returned status:', response.status);
                }
            } catch (err) {
                console.warn('[Themes] Could not save to server:', err.message);
            }

            closeModal();
        }

        // Apply theme to page
        function applyTheme(theme) {
            console.log('[Themes] Applying theme:', theme);

            // Persist a small unscoped snapshot used by other pages to avoid
            // flashing the default theme before JS finishes loading.
            try {
                let accentRgb = null;
                if (typeof theme.accent === 'string') {
                    let hex = theme.accent.trim();
                    if (hex.startsWith('#')) hex = hex.slice(1);
                    if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
                    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
                        const r = parseInt(hex.slice(0, 2), 16);
                        const g = parseInt(hex.slice(2, 4), 16);
                        const b = parseInt(hex.slice(4, 6), 16);
                        accentRgb = `${r},${g},${b}`;
                    }
                }
                localStorage.setItem('tmr_boot_theme', JSON.stringify({
                    accentColor: theme.accent || null,
                    accentRgb,
                    backgroundImage: theme.bgImage || null,
                    animation: theme.animation || null,
                    updatedAt: Date.now()
                }));
            } catch (_) {}
            
            // Apply accent color
            const root = document.documentElement;
            root.style.setProperty('--accent-color', theme.accent);
            
            // Clear ALL custom animation classes
            document.body.classList.remove('theme-particles', 'theme-gradient-flow', 'theme-wave-pulse', 'theme-triangles');
            
            // Check if applying a custom theme or returning to default
            const hasCustomAnimation = theme.animation && theme.animation !== 'none' && theme.animation !== '';
            const hasCustomImage = theme.bgImage && theme.bgImage.trim() !== '';
            
            if (hasCustomAnimation) {
                console.log('[Themes] Applying custom animation:', theme.animation);
                // Remove default background class when using custom animation
                document.body.classList.remove('triangle-background');
                // Clear inline styles for images/colors
                document.body.style.backgroundImage = 'none';
                document.body.style.backgroundColor = 'transparent';
                // Add animation class
                document.body.classList.add('theme-' + theme.animation);
            } else if (hasCustomImage) {
                console.log('[Themes] Applying custom background image');
                // Remove default background class when using custom image
                document.body.classList.remove('triangle-background');
                // Apply custom background image
                document.body.style.backgroundColor = theme.bgColor;
                document.body.style.backgroundImage = `url('${theme.bgImage}')`;
                document.body.style.backgroundSize = 'cover';
                document.body.style.backgroundPosition = 'center';
            } else {
                console.log('[Themes] Reverting to default triangle background');
                // No custom theme - revert to default
                document.body.classList.add('triangle-background');
                // Clear inline styles
                document.body.style.backgroundColor = '';
                document.body.style.backgroundImage = '';
                document.body.style.backgroundSize = '';
                document.body.style.backgroundPosition = '';
            }
        }

        // Clear image
        function clearBgImage() {
            currentTheme.bgImage = null;
            bgImageInput.value = '';
            showBgImagePreview();
        }

        // Event listeners
        headerThemesBtn.addEventListener('click', () => {
            console.log('[Themes] Button clicked, opening modal');
            openModal();
        });
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        saveBtn.addEventListener('click', saveTheme);

        themeModal.addEventListener('click', (e) => {
            if (e.target === themeModal) closeModal();
        });

        accentInput.addEventListener('input', updatePreviews);
        bgColorInput.addEventListener('input', updatePreviews);

        bgImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    currentTheme.bgImage = event.target.result;
                    showBgImagePreview();
                };
                reader.readAsDataURL(file);
            }
        });

        bgImageNoneBtn.addEventListener('click', clearBgImage);
    }
})();

// Debug: Add window function to reset all themes
window.resetThemes = function() {
    console.log('[Themes] Resetting all themes...');
    localStorage.removeItem('theme_accent_color');
    localStorage.removeItem('theme_bg_color');
    localStorage.removeItem('theme_bg_image');
    localStorage.removeItem('theme_animation');
    document.body.classList.remove('theme-particles', 'theme-gradient-flow', 'theme-wave-pulse', 'theme-triangles');
    document.body.classList.add('triangle-background');
    document.body.style.backgroundColor = '';
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
    console.log('[Themes] Reset complete! Refresh page to see changes.');
};
