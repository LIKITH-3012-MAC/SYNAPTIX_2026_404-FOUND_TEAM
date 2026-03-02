/**
 * RESOLVIT - Theme Manager
 * Handles Dark/Light mode switching, persistence, and system preference detection.
 */

const ThemeManager = {
    theme: 'dark', // default

    init() {
        // 1. Check localStorage
        const savedTheme = localStorage.getItem('resolvit_theme');

        // 2. Check system preference if no saved theme
        if (savedTheme) {
            this.theme = savedTheme;
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            this.theme = 'light';
        }

        this.apply();
        this.setupListeners();
    },

    toggle() {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        this.apply();
        localStorage.setItem('resolvit_theme', this.theme);
        showToast(`🌙 Theme switched to ${this.theme.toUpperCase()}`, 'info');
    },

    apply() {
        document.documentElement.setAttribute('data-theme', this.theme);
        // Dispatch event for components that need to re-render (like charts or maps)
        window.dispatchEvent(new CustomEvent('resolvit-theme-change', { detail: this.theme }));
    },

    setupListeners() {
        // Watch for system changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (!localStorage.getItem('resolvit_theme')) {
                this.theme = e.matches ? 'dark' : 'light';
                this.apply();
            }
        });
    }
};

// Auto-init
ThemeManager.init();
window.ThemeManager = ThemeManager;
