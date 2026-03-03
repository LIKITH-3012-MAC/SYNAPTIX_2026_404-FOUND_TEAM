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

    requireRole(role, redirectTo = 'index.html') {
        const user = this.getUser();
        if (!user || user.role !== role) {
            // If they are logged in but wrong role, show error and redirect
            if (user) {
                showToast('⛔ Access denied (Role Required: ' + role + ')', 'error');
                setTimeout(() => window.location.href = redirectTo, 1500);
                return false;
            }
            // If not logged in at all, just return false so the page can handle it (e.g. show login modal)
            return false;
        }
        return true;
    },

    /**
     * ── 🏁 Unified UI MODAL for Login/Register ───────────────────
     */
    showModal(type = 'login') {
        let modal = document.getElementById('resolvit-auth-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'resolvit-auth-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-box" style="max-width:480px; padding:40px;">
                    <div id="auth-modal-content"></div>
                    <button id="auth-modal-close" style="position:absolute;top:20px;right:20px;background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--text-muted);">✕</button>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#auth-modal-close').onclick = () => this.hideModal();
            modal.onclick = (e) => { if (e.target === modal) this.hideModal(); };
        }

        modal.style.display = 'flex';
        const content = modal.querySelector('#auth-modal-content');

        if (type === 'login') {
            content.innerHTML = `
                <div style="text-align:center;margin-bottom:30px;">
                    <div style="font-size:2.5rem;margin-bottom:10px;">⚖️</div>
                    <h3 style="font-size:1.5rem;">Citizen Sign In</h3>
                    <p style="color:var(--text-muted);font-size:0.9rem;">From Complaint to Completion.</p>
                </div>
                <div id="auth-alert"></div>
                <form id="unified-login-form" class="flex flex-col" style="gap:20px;">
                    <div class="form-group"><label class="form-label">Email</label><input type="email" id="u-email" class="form-input" required/></div>
                    <div class="form-group"><label class="form-label">Password</label><input type="password" id="u-pass" class="form-input" required/></div>
                    <button type="submit" class="btn btn-primary" style="width:100%;padding:16px;">Sign In</button>
                    <p style="text-align:center;font-size:0.85rem;color:var(--text-muted);">New यहाँ? <a href="#" onclick="Auth.showModal('register')" style="color:var(--accent);font-weight:700;">Create Account</a></p>
                </form>`;

            document.getElementById('unified-login-form').onsubmit = async (e) => {
                e.preventDefault();
                const btn = e.target.querySelector('button');
                btn.disabled = true; btn.textContent = '⏳ Verifying...';
                try {
                    const u = await this.login(document.getElementById('u-email').value, document.getElementById('u-pass').value);
                    this.hideModal();
                    showToast(`✅ Welcome back, ${u.username}!`, 'success');

                    // Role-based redirect
                    setTimeout(() => {
                        if (u.role === 'admin') window.location.href = 'admin.html';
                        else if (u.role === 'authority') window.location.href = 'authority.html';
                        else window.location.href = 'dashboard.html';
                    }, 500);
                } catch (err) {
                    document.getElementById('auth-alert').innerHTML = `<div class="alert alert-error" style="margin-bottom:15px;">❌ ${err.message}</div>`;
                    btn.disabled = false; btn.textContent = 'Sign In';
                }
            };
        } else {
            content.innerHTML = `
                <div style="text-align:center;margin-bottom:30px;">
                    <div style="font-size:2.5rem;margin-bottom:10px;">🚀</div>
                    <h3 style="font-size:1.5rem;">Register Citizen</h3>
                    <p style="color:var(--text-muted);font-size:0.9rem;">Join the accountability engine.</p>
                </div>
                <div id="auth-alert"></div>
                <form id="unified-reg-form" class="flex flex-col" style="gap:15px;">
                    <div class="form-group"><label class="form-label">Name</label><input type="text" id="u-name" class="form-input" required minlength="3"/></div>
                    <div class="form-group"><label class="form-label">Email</label><input type="email" id="u-email" class="form-input" required/></div>
                    <div class="form-group"><label class="form-label">Password</label><input type="password" id="u-pass" class="form-input" required minlength="8"/></div>
                    <button type="submit" class="btn btn-primary" style="width:100%;padding:16px;">Create Account</button>
                    <p style="text-align:center;font-size:0.85rem;color:var(--text-muted);">Account exists? <a href="#" onclick="Auth.showModal('login')" style="color:var(--accent);font-weight:700;">Sign In</a></p>
                </form>`;

            document.getElementById('unified-reg-form').onsubmit = async (e) => {
                e.preventDefault();
                const btn = e.target.querySelector('button');
                btn.disabled = true; btn.textContent = '⏳ Processing...';
                try {
                    const email = document.getElementById('u-email').value;
                    const pass = document.getElementById('u-pass').value;
                    await this.register({ username: document.getElementById('u-name').value, email, password: pass, role: 'citizen' });
                    await this.login(email, pass);
                    this.hideModal();
                    showToast(`✨ Welcome to RESOLVIT!`, 'success');
                    setTimeout(() => location.reload(), 800);
                } catch (err) {
                    document.getElementById('auth-alert').innerHTML = `<div class="alert alert-error" style="margin-bottom:15px;">❌ ${err.message}</div>`;
                    btn.disabled = false; btn.textContent = 'Create Account';
                }
            };
        }
    },

    hideModal() {
        const modal = document.getElementById('resolvit-auth-modal');
        if (modal) modal.style.display = 'none';
    },

    /**
     * Unified UI — Update Navbar based on User State.
     */
    updateNavbar() {
        const el = document.getElementById('nav-actions');
        if (!el) return;

        const user = this.getUser();

        // Theme Toggle HTML
        const themeToggle = `
            <button class="theme-toggle" onclick="ThemeManager.toggle()" title="Toggle Theme" style="background:none;border:none;cursor:pointer;font-size:1.4rem;">
                <span class="sun">🌞</span><span class="moon">🌙</span>
            </button>
        `;

        // Backend Status HTML
        const statusBadge = `
            <div id="backend-status" class="status-badge" style="display:flex;align-items:center;gap:6px;font-size:0.75rem;padding:4px 10px;background:var(--bg-secondary);border-radius:20px;">
                <span class="status-dot" style="width:8px;height:8px;border-radius:50%;background:#faad14;"></span>
                <span class="status-text">Detecting...</span>
            </div>
        `;

        if (!user) {
            el.innerHTML = `
                <div style="display:flex;align-items:center;gap:15px;">
                    ${statusBadge}
                    ${themeToggle}
                    <button class="btn btn-outline btn-sm" onclick="Auth.showModal('login')">Login</button>
                    <a href="submit.html" class="btn btn-primary btn-sm">Report Issue</a>
                </div>
            `;
        } else {
            let portalLink = '';
            if (user.role === 'citizen') portalLink = `<a href="citizen.html" class="btn btn-ghost btn-sm" id="nav-pts-badge">⭐ Profile</a>`;
            else if (user.role === 'admin') portalLink = `<a href="admin.html" class="btn btn-ghost btn-sm">🏛️ Admin</a>`;
            else portalLink = `<a href="authority.html" class="btn btn-ghost btn-sm">🏢 Portal</a>`;

            el.innerHTML = `
                <div style="display:flex;align-items:center;gap:15px;">
                    ${statusBadge}
                    ${themeToggle}
                    ${portalLink}
                    <span style="font-size:0.85rem;font-weight:700;">👤 ${user.username}</span>
                    <button class="btn btn-ghost btn-sm" onclick="Auth.logout();location.reload();">Logout</button>
                </div>
            `;
        }

        // Init Status Listener
        window.addEventListener('resolvit-api-status', e => {
            const badge = document.getElementById('backend-status');
            if (!badge) return;
            const dot = badge.querySelector('.status-dot');
            const txt = badge.querySelector('.status-text');
            if (e.detail === 'online') { dot.style.background = '#52c41a'; txt.textContent = 'Connected'; }
            else if (e.detail === 'waking') { dot.style.background = '#faad14'; txt.textContent = 'Waking...'; }
            else { dot.style.background = '#f5222d'; txt.textContent = 'Offline'; }
        });

        if (typeof API !== 'undefined') API.checkHealth();
    }
};

// Global polyfill for index/submit.html
window.openLogin = () => Auth.showModal('login');
window.showAuthModal = () => Auth.showModal('login');

