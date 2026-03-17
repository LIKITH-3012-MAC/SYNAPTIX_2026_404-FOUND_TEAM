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
        
        if (typeof showToast === 'function') {
            const icon = this.theme === 'dark' ? '🌙' : '🌞';
            showToast(`${icon} Theme set to ${this.theme.toUpperCase()}`, 'info');
        }
    },

    apply() {
        document.documentElement.setAttribute('data-theme', this.theme);
        
        // Update all toggle buttons on page
        document.querySelectorAll('.theme-toggle').forEach(btn => {
            btn.setAttribute('aria-label', `Switch to ${this.theme === 'dark' ? 'light' : 'dark'} mode`);
        });

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
        
        // Ensure UI stays in sync if theme is changed from another script
        window.addEventListener('resolvit-theme-change', (e) => {
            if (e.detail !== this.theme) {
                this.theme = e.detail;
                document.documentElement.setAttribute('data-theme', this.theme);
            }
        });
    }
};

// Auto-init
ThemeManager.init();
window.ThemeManager = ThemeManager;
