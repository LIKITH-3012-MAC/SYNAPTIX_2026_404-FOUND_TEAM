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

    requireRole(roleOrRoles, redirectTo = 'index.html') {
        const user = this.getUser();
        const allowed = Array.isArray(roleOrRoles) ? roleOrRoles.map(r => r.toLowerCase()) : [roleOrRoles.toLowerCase()];

        if (!user || !allowed.includes(String(user.role).toLowerCase())) {
            if (user) {
                showToast('⛔ Access denied (Role Required: ' + allowed.join(' or ') + ')', 'error');
                setTimeout(() => window.location.href = redirectTo, 1500);
                return false;
            }
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
                    <div class="form-group"><label class="form-label">Password</label>
                        <input type="password" id="u-pass" class="form-input" required minlength="8"/>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">Minimum 8 chars, 1 uppercase, 1 digit</div>
                    </div>
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
            <button class="theme-toggle" onclick="ThemeManager.toggle()" title="Toggle Theme" style="background:none;border:none;cursor:pointer;font-size:1.4rem;display:flex;align-items:center;">
                <span class="sun">🌞</span><span class="moon">🌙</span>
            </button>
        `;

        // Language Selector HTML
        const langOptions = Object.entries(i18n.languages).map(([code, meta]) => 
            `<option value="${code}" ${i18n.currentLang === code ? 'selected' : ''}>${meta.flag} ${meta.name}</option>`
        ).join('');

        const langSelector = `
            <div class="lang-selector-wrap" style="position:relative;display:flex;align-items:center;">
                <select class="lang-select" onchange="i18n.setLanguage(this.value)" style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:12px;padding:4px 8px;font-size:0.8rem;cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;">
                    ${langOptions}
                </select>
                <div style="position:absolute;right:8px;pointer-events:none;font-size:0.6rem;opacity:0.5;">▼</div>
            </div>
        `;



        if (!user) {
            el.innerHTML = `
                <div class="desktop-actions" style="display:flex;align-items:center;gap:15px;">
                    ${langSelector}
                    ${themeToggle}
                    <button class="btn btn-outline btn-sm" onclick="Auth.showModal('login')" data-i18n="nav_login">Login</button>
                    <a href="submit.html" class="btn btn-primary btn-sm" data-i18n="nav_report">Report Issue</a>
                </div>
            `;
        } else {
            let portalLink = '';
            if (user.role === 'citizen') portalLink = `<a href="citizen.html" class="btn btn-ghost btn-sm" id="nav-pts-badge" data-i18n="nav_profile">⭐ Profile</a>`;
            else if (user.role === 'admin') portalLink = `<a href="admin.html" class="btn btn-ghost btn-sm" data-i18n="nav_admin">🏛️ Admin</a>`;
            else portalLink = `<a href="authority.html" class="btn btn-ghost btn-sm" data-i18n="nav_portal">🏢 Portal</a>`;

            el.innerHTML = `
                <div class="desktop-actions" style="display:flex;align-items:center;gap:15px;">
                    ${langSelector}
                    ${themeToggle}
                    ${portalLink}
                    <span class="nav-username">👤 ${user.username}</span>
                    <button class="btn btn-ghost btn-sm" onclick="Auth.logout();location.reload();" data-i18n="nav_logout">Logout</button>
                </div>
            `;
        }

        // Apply translations immediately to the new elements
        if (window.i18n) i18n.apply();

        // Mobile Menu Generator — inject standard hamburger button into navbar-inner if missing
        let mobileBtn = document.getElementById('mobile-menu-btn');
        if (!mobileBtn) {
            mobileBtn = document.createElement('button');
            mobileBtn.id = 'mobile-menu-btn';
            mobileBtn.className = 'mobile-menu-btn';
            mobileBtn.innerHTML = '☰';
            mobileBtn.style.display = 'none'; // Controlled via CSS Media Query
            mobileBtn.onclick = () => {
                document.getElementById('navbar').classList.toggle('mobile-menu-open');
                mobileBtn.innerHTML = document.getElementById('navbar').classList.contains('mobile-menu-open') ? '✕' : '☰';
            };
            el.parentElement.appendChild(mobileBtn);
        }



        if (typeof API !== 'undefined') API.checkHealth();
    }
};

// Global polyfill for index/submit.html
window.openLogin = () => Auth.showModal('login');
window.showAuthModal = () => Auth.showModal('login');

