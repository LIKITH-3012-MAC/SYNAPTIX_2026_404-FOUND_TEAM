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
    }
};
