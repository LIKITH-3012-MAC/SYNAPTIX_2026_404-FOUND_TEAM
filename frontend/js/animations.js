/**
 * RESOLVIT - Animations Module (animations.js)
 * Animated counters, skeleton loaders, ripple effects, and micro-interactions.
 */

/* ── Animated Counter ─────────────────────────────────────────── */
function animateCounter(elementId, targetValue, suffix = '', duration = 1500) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const start = 0;
    const startTime = performance.now();
    const isDecimal = String(targetValue).includes('.');

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutCubic(progress);
        const current = start + (targetValue - start) * eased;

        if (targetValue >= 1000) {
            el.textContent = Math.floor(current).toLocaleString('en-IN') + suffix;
        } else if (isDecimal) {
            el.textContent = current.toFixed(1) + suffix;
        } else {
            el.textContent = Math.floor(current) + suffix;
        }

        if (progress < 1) requestAnimationFrame(update);
        else el.textContent = (targetValue >= 1000 ? targetValue.toLocaleString('en-IN') : targetValue) + suffix;
    }

    requestAnimationFrame(update);
}

/* ── Button Ripple Effect ────────────────────────────────────── */
document.addEventListener('click', (e) => {
    const btn = e.target.closest('button, .btn, a.btn-hero, a.btn-hero-outline');
    if (!btn || btn.tagName === 'A') return;

    const rect = btn.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ripple = document.createElement('span');

    ripple.style.cssText = `
    position:absolute; border-radius:50%;
    transform:scale(0); animation:ripple-expand 0.6s linear;
    background:rgba(255,255,255,0.25);
    width:100px; height:100px;
    left:${x - 50}px; top:${y - 50}px;
    pointer-events:none; z-index:9999;
  `;

    if (!btn.style.position || btn.style.position === 'static') {
        btn.style.overflow = 'hidden';
    }

    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
});

// Inject ripple keyframe
const style = document.createElement('style');
style.textContent = `
  @keyframes ripple-expand {
    to { transform: scale(4); opacity: 0; }
  }
`;
document.head.appendChild(style);

/* ── Intersection Observer — Animate-on-scroll ───────────────── */
const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
            entry.target.style.animationDelay = `${i * 0.05}s`;
            entry.target.style.opacity = '1';
            entry.target.style.animation = 'slideUp 0.4s ease forwards';
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.08 });

// Observe cards and sections on load
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.card, .issue-card, .metric-card').forEach(el => {
        el.style.opacity = '0';
        observer.observe(el);
    });
});

/* ── Hover Elevation Enhancement ─────────────────────────────── */
document.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.issue-card');
    if (card) card.style.zIndex = '10';
});
document.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.issue-card');
    if (card) card.style.zIndex = '';
});

/* ── Priority Score Flash on Change ──────────────────────────── */
function flashPriorityScore(elementId, newScore) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.style.animation = 'scoreFlash 0.6s ease';
    el.textContent = newScore;
    setTimeout(() => el.style.animation = '', 600);
}

/* ── Page Loading Bar ─────────────────────────────────────────── */
(function initPageBar() {
    const bar = document.createElement('div');
    bar.id = 'page-load-bar';
    bar.style.cssText = 'position:fixed;top:0;left:0;height:3px;background:linear-gradient(90deg,#1E3A8A,#3b82f6);z-index:99999;transition:width 0.3s ease;width:0%;';
    document.body.prepend(bar);

    let width = 0;
    const interval = setInterval(() => {
        width = Math.min(width + (100 - width) * 0.08, 90);
        bar.style.width = width + '%';
    }, 100);

    window.addEventListener('load', () => {
        clearInterval(interval);
        bar.style.width = '100%';
        setTimeout(() => { bar.style.opacity = '0'; setTimeout(() => bar.remove(), 300); }, 300);
    });
})();

/* ── Number formatting helper ─────────────────────────────────── */
function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}
