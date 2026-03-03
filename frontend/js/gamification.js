/**
 * RESOLVIT - Gamification & Civic Credit Engine (gamification.js)
 * Handles points, badges, milestones, and high-fidelity visual rewards.
 */

const Gamification = (() => {
    const POINTS_CONFIG = {
        REPORT_SUBMITTED: 10,
        EVIDENCE_ADDED: 15,
        ISSUE_RESOLVED: 50,
        HELPFUL_VOTE: 5,
        CONSECUTIVE_REPORTS: 20
    };

    const BADGES = [
        { id: 'newcomer', name: 'Civic Scout', icon: '⛺', threshold: 0 },
        { id: 'contributor', name: 'Active Citizen', icon: '🏙️', threshold: 100 },
        { id: 'expert', name: 'Urban Insight', icon: '🧠', threshold: 500 },
        { id: 'hero', name: 'Civic Hero', icon: '🦸', threshold: 1000 },
        { id: 'legend', name: 'Legendary Guardian', icon: '🛡️', threshold: 5000 }
    ];

    return {
        /**
         * Get current user's gamification profile.
         */
        async getProfile() {
            try {
                const user = Auth.getUser();
                if (!user) return null;
                // In a real app, this would be an API call /api/gamification/profile
                // For hackathon mode, we derive from local storage or mock
                const localData = JSON.parse(localStorage.getItem(`gamify_${user.id}`) || '{"points": 0, "badges": []}');
                return localData;
            } catch (e) { return { points: 0, badges: [] }; }
        },

        /**
         * Logic for awarding points and triggering "wow factor" visuals.
         */
        async awardPoints(actionType) {
            const points = POINTS_CONFIG[actionType] || 0;
            if (points === 0) return;

            const user = Auth.getUser();
            if (!user) return;

            const profile = await this.getProfile();
            profile.points += points;

            // Check for new badges
            const newBadges = BADGES.filter(b => profile.points >= b.threshold && !profile.badges.includes(b.id));
            newBadges.forEach(b => profile.badges.push(b.id));

            localStorage.setItem(`gamify_${user.id}`, JSON.stringify(profile));

            this.triggerVisualFeedback(points, newBadges);
        },

        /**
         * Visual Storytelling: Confetti and floating point indicators.
         */
        triggerVisualFeedback(pts, newBadges) {
            // 1. Confetti (using a simple emoji-based fallback if library not present)
            this.launchEmojiConfetti(newBadges.length > 0 ? '🏆' : '✨');

            // 2. Point Toast
            showToast(`+${pts} Civic Credits earned!`, 'success');

            if (newBadges.length > 0) {
                const latest = newBadges[newBadges.length - 1];
                this.showBadgeModal(latest);
            }
        },

        launchEmojiConfetti(emoji) {
            for (let i = 0; i < 20; i++) {
                const div = document.createElement('div');
                div.textContent = emoji;
                div.style.position = 'fixed';
                div.style.left = Math.random() * 100 + 'vw';
                div.style.top = '100vh';
                div.style.fontSize = '2rem';
                div.style.zIndex = '10000';
                div.style.pointerEvents = 'none';
                div.style.transition = 'all 3s ease-out';

                document.body.appendChild(div);

                setTimeout(() => {
                    div.style.transform = `translate(${(Math.random() - 0.5) * 400}px, -120vh) rotate(${Math.random() * 720}deg)`;
                    div.style.opacity = '0';
                }, 10);

                setTimeout(() => div.remove(), 3000);
            }
        },

        showBadgeModal(badge) {
            const modal = document.createElement('div');
            modal.className = 'glass modal-overlay';
            modal.style.display = 'flex';
            modal.style.zIndex = '20000';
            modal.innerHTML = `
        <div class="glass card floating" style="text-align:center; padding:40px; max-width:400px;">
          <div style="font-size:5rem; margin-bottom:20px;">${badge.icon}</div>
          <h2 style="color:var(--accent); margin-bottom:12px;">New Badge Unlocked!</h2>
          <h1 style="margin-bottom:20px;">${badge.name}</h1>
          <p class="text-secondary" style="margin-bottom:30px;">Your contribution to the city has leveled up. Keep leading the change!</p>
          <button class="btn-cyber" onclick="this.closest('.modal-overlay').remove()">Continue Mission</button>
        </div>
      `;
            document.body.appendChild(modal);
        }
    };
})();

window.Gamification = Gamification;
