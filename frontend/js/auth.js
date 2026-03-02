/**
 * RESOLVIT - Auth Module (auth.js)
 * Login, logout, token management, and user state.
 */
const Auth = {
    /**
     * Authenticate with email + password. Returns user data + token.
     */
    async login(email, password) {
        const data = await API.post('/api/auth/login', { email, password });
        localStorage.setItem('resolvit_token', data.access_token);
        localStorage.setItem('resolvit_user', JSON.stringify({
            id: data.user_id,
            username: data.username,
            role: data.role,
        }));
        return data;
    },

    /**
     * Register a new user account.
     */
    async register(payload) {
        return API.post('/api/auth/register', payload);
    },

    /**
     * Logout — clear stored credentials.
     */
    logout() {
        localStorage.removeItem('resolvit_token');
        localStorage.removeItem('resolvit_user');
    },

    /**
     * Get the currently stored user object.
     * @returns {Object|null}
     */
    getUser() {
        try {
            const raw = localStorage.getItem('resolvit_user');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    },

    /**
     * Check if user has a specific role.
     */
    hasRole(...roles) {
        const user = this.getUser();
        return user ? roles.includes(user.role) : false;
    },

    /**
     * Guard — redirect to index if not authenticated.
     */
    requireAuth(redirectTo = 'index.html') {
        if (!this.getUser()) {
            showToast('⚠️ Please login to access this page.');
            setTimeout(() => window.location.href = redirectTo, 1500);
            return false;
        }
        return true;
    },

    /**
     * Guard — redirect if not the required role.
     */
    requireRole(role, redirectTo = 'index.html') {
        const user = this.getUser();
        if (!user || user.role !== role) {
            showToast('⛔ Access denied.');
            setTimeout(() => window.location.href = redirectTo, 1500);
            return false;
        }
        return true;
    },

    /**
     * Return Authorization header object for fetch calls.
     */
    getHeaders() {
        const token = localStorage.getItem('resolvit_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    },

    /**
     * Unified UI — Update Navbar based on Role.
     */
    /**
     * Unified UI — Update Navbar based on Role.
     */
    updateNavbar() {
        const el = document.getElementById('nav-actions');
        if (!el) return;

        const user = this.getUser();

        // Theme Toggle HTML
        const themeToggle = `
            <button class="theme-toggle" onclick="ThemeManager.toggle()" title="Toggle Theme">
                <span class="sun">🌞</span><span class="moon">🌙</span>
            </button>
        `;

        // Backend Status HTML
        const statusBadge = `
            <div id="backend-status" class="status-badge" title="Backend Connection Status">
                <span class="status-dot"></span>
                <span class="status-text">Detecting...</span>
            </div>
        `;

        if (!user) {
            el.innerHTML = `
                ${statusBadge}
                ${themeToggle}
                <button class="btn btn-outline btn-sm" onclick="typeof openLogin === 'function' ? openLogin() : location.href='index.html#login'">Login</button>
                <a href="submit.html" class="btn btn-primary btn-sm">Report Issue</a>
            `;
        } else {
            let extraLink = '';
            if (user.role === 'citizen') {
                extraLink = `<a href="citizen.html" class="btn btn-ghost btn-sm" id="nav-pts-badge">⭐ My Profile</a>`;
            } else if (user.role === 'admin') {
                extraLink = `<a href="admin.html" class="btn btn-ghost btn-sm">🏛️ Admin Tower</a>`;
            } else if (user.role === 'authority') {
                extraLink = `<a href="authority.html" class="btn btn-ghost btn-sm">🏛️ Portal</a>`;
            }

            el.innerHTML = `
                ${statusBadge}
                ${themeToggle}
                ${extraLink}
                <span class="nav-username">👤 ${user.username}</span>
                <button class="btn btn-ghost btn-sm" onclick="Auth.logout();location.reload();">Logout</button>
            `;

            if (user.role === 'citizen' && typeof API !== 'undefined') {
                API.get('/api/credits/me').then(c => {
                    const badge = document.getElementById('nav-pts-badge');
                    if (badge && c.total_points > 0) badge.textContent = `⭐ ${c.total_points} pts`;
                }).catch(() => { });
            }
        }

        // Init Status Listener
        window.addEventListener('resolvit-api-status', e => {
            const badge = document.getElementById('backend-status');
            if (!badge) return;
            badge.className = `status-badge status-${e.detail}`;
            const text = badge.querySelector('.status-text');
            if (e.detail === 'online') text.textContent = 'Connected';
            if (e.detail === 'waking') text.textContent = 'Waking Up...';
            if (e.detail === 'offline') text.textContent = 'Disconnected';
        });

        // Trigger initial check
        if (typeof API !== 'undefined') API.checkHealth();
    }
};

