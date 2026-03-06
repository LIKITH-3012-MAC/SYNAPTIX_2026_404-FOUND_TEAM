/**
 * RESOLVIT - Smooth Scroll & Animation Engine
 * Implements Lenis for ultra-smooth buttery scrolling.
 * Configured for 60/120/144/240Hz screens.
 */

document.addEventListener("DOMContentLoaded", () => {
    // 1. Initialize Lenis (High-performance smooth scrolling engine)
    const lenis = new Lenis({
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Custom easing for premium feel
        direction: 'vertical',
        gestureDirection: 'vertical',
        smooth: true,
        smoothTouch: false, // let mobile handle native momentum scrolling by default
        touchMultiplier: 2,
        infinite: false,
    });

    // 2. Integration with Leaflet maps (prevent map scroll hijacking the page or vice-versa)
    const mapContainers = document.querySelectorAll('.leaflet-container');
    mapContainers.forEach(map => {
        map.addEventListener('wheel', (e) => {
            // Stop lenis scrolling when zooming the map
            e.stopPropagation();
        });
    });

    // 3. RAF Loop to lock animations to monitor refresh rate (60-240 FPS)
    function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);

    // 4. Expose globally
    window.lenis = lenis;

    // 5. Hardware acceleration lazy load observer
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
                // Optional: remove after animated if no longer needed
            }
        });
    }, {
        rootMargin: "100px 0px"
    });

    // Add GPU layer class to heavily used elements
    const elementsToAccelerate = document.querySelectorAll('.card, .issue-card, .metric-card, .glass');
    elementsToAccelerate.forEach(el => {
        el.classList.add('gpu-accelerate');
        // Let it fade or slide in smoothly via CSS if we want
        observer.observe(el);
    });
});
