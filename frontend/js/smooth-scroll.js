/**
 * RESOLVIT - Smooth Scroll & Animation Engine v4
 * Implements Lenis for ultra-smooth buttery scrolling.
 * Optimized for Mobile (Touch) and Laptop (High-Hz Displays/Trackpads).
 * Automatically detects the best scroll target for the current layout.
 */

document.addEventListener("DOMContentLoaded", () => {
    // 1. Determine local scroller if any (e.g. for Admin Dash)
    const adminMain = document.querySelector('.admin-main');
    const localWrapper = adminMain || window;
    const localContent = adminMain ? adminMain.children[0] : document.documentElement;

    // 2. Initialize Lenis (High-performance smooth scrolling engine)
    const lenis = new Lenis({
        wrapper: adminMain ? adminMain : window,
        content: adminMain ? adminMain : document.documentElement,
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Custom easing for premium feel
        direction: 'vertical',
        gestureDirection: 'vertical',
        smooth: true,
        smoothTouch: false, // Let native OS momentum take over on mobile for 100% natural feel
        touchMultiplier: 1.5,
        infinite: false,
    });

    // 3. Integration with Layouts
    // Prevent Lenis from highjacking internal scrollable containers (hubs, modals)
    const preventScrollSelectors = [
        '#resolution-hub-drawer .hub-body',
        '.drawer-body',
        '.modal-body',
        '.custom-scrollbar',
        '.admin-sidebar'
    ];
    
    preventScrollSelectors.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) el.setAttribute('data-lenis-prevent', '');
    });

    // 4. Integration with Leaflet maps (prevent map scroll hijacking)
    const mapContainers = document.querySelectorAll('.leaflet-container, #heatmap, #authority-map, #dashboard-map, #radar-map');
    mapContainers.forEach(map => {
        map.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });
        map.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });
    });

    // 5. RAF Loop to lock animations to monitor refresh rate (60-240 FPS)
    function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    // 6. Expose globally
    window.lenis = lenis;

    // 7. Performance: GPU-accelerated intersections
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
            }
        });
    }, { rootMargin: "100px 0px" });

    // Target major cards and modules
    const elementsToAccelerate = document.querySelectorAll('.card, .issue-card, .metric-card, .glass-card-premium, .hub-module, .ctrl-card, .panel');
    elementsToAccelerate.forEach(el => {
        el.classList.add('gpu-accelerate');
        observer.observe(el);
    });

    // 8. Handle Anchor Links with smooth scroll offset
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href === '#') return;
            
            e.preventDefault();
            const target = document.querySelector(href);
            if (target) {
                lenis.scrollTo(target, { offset: -80 });
            }
        });
    });

    // 9. Sync with route changes (if applicable)
    // For URL-driven architecture: scroll to top on new selection if it's the main page
    if (!adminMain) {
        window.addEventListener('popstate', () => {
            lenis.scrollTo(0, { immediate: true });
        });
    }
});
