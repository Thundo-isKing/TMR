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

        // Apply stored theme on init - but only if there's actually a custom theme saved
        const hasCustomTheme = localStorage.getItem(STORAGE_KEY_ANIMATION) !== null || 
                               localStorage.getItem(STORAGE_KEY_BG_IMAGE) !== null;
        if (hasCustomTheme) {
            console.log('[Themes] Custom theme found, applying...');
            applyTheme(currentTheme);
        } else {
            console.log('[Themes] No custom theme found, using default background');
        }

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

            // Save to server if logged in
            const token = localStorage.getItem('access_token');
            if (token) {
                try {
                    await fetch('/api/themes', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'x-user-id': localStorage.getItem('user_id') || 'guest',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            accentColor: currentTheme.accent,
                            backgroundColor: currentTheme.bgColor,
                            backgroundImage: currentTheme.bgImage,
                            animationType: currentTheme.animation
                        })
                    });
                } catch (err) {
                    console.error('[Themes] Error saving to server:', err);
                }
            }

            closeModal();
        }

        // Apply theme to page
        function applyTheme(theme) {
            console.log('[Themes] Applying theme:', theme);
            
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
