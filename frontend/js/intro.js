/**
 * RESOLVIT - Premium Intro Animation Controller
 * Handles the session-aware cinemetic opening experience.
 */

(function() {
    const INTRO_ID = 'resolvit-intro-experience';
    const STORAGE_KEY = 'resolvit_session_intro_seen';

    function createIntroNodes(container) {
        if (!container) return;
        
        // Add 20-30 ambient coordinate nodes
        const count = window.innerWidth < 768 ? 15 : 30;
        for (let i = 0; i < count; i++) {
            const node = document.createElement('div');
            node.className = 'intro-node';
            
            // Random positioning and staggered animation
            node.style.top = Math.random() * 100 + '%';
            node.style.left = Math.random() * 100 + '%';
            node.style.animationDelay = (Math.random() * 4) + 's';
            node.style.animationDuration = (3 + Math.random() * 3) + 's';
            
            container.appendChild(node);
        }
    }

    function startIntro() {
        // 1. Check if seen in current session
        if (sessionStorage.getItem(STORAGE_KEY)) {
            const existing = document.getElementById(INTRO_ID);
            if (existing) existing.remove();
            return;
        }

        const introOverlay = document.getElementById(INTRO_ID);
        if (!introOverlay) return;

        // Initialize ambient visuals
        const nodesContainer = introOverlay.querySelector('.intro-nodes');
        createIntroNodes(nodesContainer);

        // Lockdown body scroll during intro
        document.body.style.overflow = 'hidden';

        // 2. Set the completion timeline 
        // Total duration is roughly 3 seconds
        setTimeout(() => {
            introOverlay.classList.add('fade-out');
            
            // Restore scrolling slightly before removal
            setTimeout(() => {
                document.body.style.overflow = '';
            }, 500);

            // 3. Mark as seen and cleanup DOM
            setTimeout(() => {
                sessionStorage.setItem(STORAGE_KEY, 'true');
                introOverlay.remove();
                
                // Proactively trigger a custom event if main app needs to refresh/init
                window.dispatchEvent(new CustomEvent('resolvit-intro-complete'));
            }, 1000); // Wait for CSS transition
        }, 3200); 
    }

    // Initialize as early as possible
    if (document.readyState === 'complete') {
        startIntro();
    } else {
        window.addEventListener('load', startIntro);
    }
})();
