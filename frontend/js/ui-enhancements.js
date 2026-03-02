/**
 * RESOLVIT - UI Enhancements
 * Handles floating theme toggle, backend status indicator, and animated counters.
 */

const UIEnhancements = {
    init() {
        this.createFloatingToggle();
        this.initStatusIndicator();
        this.initCounters();
        this.setupScrollEffects();
    },

    createFloatingToggle() {
        if (document.getElementById('floating-theme-toggle')) return;

        const toggle = document.createElement('div');
        toggle.id = 'floating-theme-toggle';
        toggle.className = 'floating-toggle';
        toggle.innerHTML = `
            <div class="toggle-icon">
                <span class="icon-sun">🌞</span>
                <span class="icon-moon">🌙</span>
            </div>
        `;
        document.body.appendChild(toggle);

        toggle.addEventListener('click', () => {
            if (window.ThemeManager) {
                window.ThemeManager.toggle();
                this.updateToggleState();
            }
        });

        this.updateToggleState();

        // Listen for theme changes from other sources
        window.addEventListener('resolvit-theme-change', () => this.updateToggleState());
    },

    updateToggleState() {
        const toggle = document.getElementById('floating-theme-toggle');
        if (!toggle) return;
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        toggle.className = `floating-toggle ${currentTheme}`;
    },

    initStatusIndicator() {
        // Find or create status indicator in navbar
        const navActions = document.getElementById('nav-actions');
        if (!navActions) return;

        let statusBox = document.getElementById('backend-status-indicator');
        if (!statusBox) {
            statusBox = document.createElement('div');
            statusBox.id = 'backend-status-indicator';
            statusBox.className = 'status-box';
            navActions.prepend(statusBox);
        }

        // Listen for API status changes
        window.addEventListener('resolvit-api-status', (e) => {
            const status = e.detail;
            this.updateStatusUI(status);
        });

        // Initial check if API is already loaded
        if (window.API && window.API.status) {
            this.updateStatusUI(window.API.status);
        }
    },

    updateStatusUI(status) {
        const box = document.getElementById('backend-status-indicator');
        if (!box) return;

        let label = 'Offline';
        let color = 'var(--red)';
        let pulse = false;

        if (status === 'online') {
            label = 'Live';
            color = 'var(--green)';
        } else if (status === 'waking' || status === 'connecting') {
            label = 'Waking';
            color = 'var(--yellow)';
            pulse = true;
        }

        box.innerHTML = `
            <span class="status-dot" style="background:${color}; ${pulse ? 'animation: pulse 1.5s infinite;' : ''}"></span>
            <span class="status-label">${label}</span>
        `;
        box.className = `status-box ${status}`;
    },

    initCounters() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.animateCounter(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });

        document.querySelectorAll('.stat-number').forEach(num => observer.observe(num));
    },

    animateCounter(el) {
        const target = parseInt(el.innerText.replace(/[^0-9]/g, ''));
        const suffix = el.innerText.replace(/[0-9]/g, '');
        let count = 0;
        const duration = 2000;
        const startTime = performance.now();

        const update = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const ease = 1 - Math.pow(1 - progress, 3);

            count = Math.floor(ease * target);
            el.innerText = count + suffix;

            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                el.innerText = target + suffix;
            }
        };

        requestAnimationFrame(update);
    },

    setupScrollEffects() {
        const navbar = document.getElementById('navbar');
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        });
    }
};

// Auto-init
document.addEventListener('DOMContentLoaded', () => UIEnhancements.init());
window.UIEnhancements = UIEnhancements;
