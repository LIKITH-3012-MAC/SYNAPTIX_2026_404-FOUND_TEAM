/**
 * RESOLVIT - UI Enhancements
 * Handles floating theme toggle, backend status indicator, and animated counters.
 */

const UIEnhancements = {
    init() {
        this.createFloatingToggle();
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
        if (!navbar) return;
        
        const updateNavbar = (y) => {
            if (y > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        };

        const initScroll = () => {
            // If Lenis is active, sync with it
            if (window.lenis) {
                window.lenis.on('scroll', (e) => updateNavbar(e.animatedScroll));
            } else {
                // Fallback for native scroll
                const scroller = document.querySelector('.admin-main') || window;
                scroller.addEventListener('scroll', () => {
                    const y = scroller === window ? window.scrollY : scroller.scrollTop;
                    updateNavbar(y);
                });
            }
        };

        // Delay slightly to ensure Lenis is ready if it's running on same DOMContentLoaded
        setTimeout(initScroll, 100);
    }
};

// Auto-init
document.addEventListener('DOMContentLoaded', () => UIEnhancements.init());
window.UIEnhancements = UIEnhancements;
