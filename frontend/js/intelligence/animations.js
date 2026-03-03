/**
 * ELITE URBAN INTELLIGENCE - Reusable Animation Utilities
 */

export const Animations = {
    /**
     * Injects the necessary CSS for animations into the document
     */
    injectStyles() {
        if (document.getElementById('intelligence-animations')) return;

        const style = document.createElement('style');
        style.id = 'intelligence-animations';
        style.textContent = `
            @keyframes intelligence-pulse {
                0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 46, 46, 0.7); }
                70% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(255, 46, 46, 0); }
                100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 46, 46, 0); }
            }

            @keyframes intelligence-scale-in {
                0% { transform: scale(0); opacity: 0; }
                100% { transform: scale(1); opacity: 1; }
            }

            @keyframes intelligence-glow {
                0% { filter: drop-shadow(0 0 2px rgba(255,255,255,0.5)); }
                50% { filter: drop-shadow(0 0 8px rgba(255,255,255,0.8)); }
                100% { filter: drop-shadow(0 0 2px rgba(255,255,255,0.5)); }
            }

            .animate-pulse-high {
                animation: intelligence-pulse 1.5s infinite ease-in-out;
            }

            .animate-scale-in {
                animation: intelligence-scale-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
            }

            .cluster-hover-glow:hover {
                transform: scale(1.1) !important;
                filter: brightness(1.2) drop-shadow(0 0 15px rgba(255, 255, 255, 0.5));
                transition: all 0.3s ease;
                z-index: 1000 !important;
            }
        `;
        document.head.appendChild(style);
    },

    /**
     * Applies a smooth transition between two values
     */
    lerp(start, end, amt) {
        return (1 - amt) * start + amt * end;
    }
};
