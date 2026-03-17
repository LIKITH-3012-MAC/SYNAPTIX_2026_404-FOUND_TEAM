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
            id:            data.user_id,
            username:      data.username,
            email:         email,
            role:          data.role,
            department:    data.department || null,
            auth_provider: 'database'
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
        const user = this.getUser();
        const isOAuth = user && user.auth_provider && user.auth_provider !== 'database';
        
        localStorage.removeItem('resolvit_token');
        localStorage.removeItem('resolvit_user');
        
        // For ALL OAuth logins (Google, GitHub, Twitter) also sign out from Auth0
        if (isOAuth && window.Auth0Integration) {
            Auth0Integration.logout();  // handles Auth0 + redirect
            return;
        }
        // Email/password: just stay on page (caller handles redirect)
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
            const _toast = typeof showToast === 'function' ? showToast : console.warn;
            _toast('⚠️ Please login to access this page.', 'warning');
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

                <!-- Google Login Button -->
                <button type="button" onclick="loginWithGoogle()" class="btn" style="width:100%;padding:14px;margin-bottom:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:14px;color:white;font-weight:700;font-size:0.95rem;display:flex;align-items:center;justify-content:center;gap:12px;cursor:pointer;transition:all 0.3s ease;backdrop-filter:blur(8px);" onmouseover="this.style.background='rgba(99,102,241,0.15)';this.style.borderColor='var(--accent)'" onmouseout="this.style.background='rgba(255,255,255,0.06)';this.style.borderColor='rgba(255,255,255,0.15)'">
                    <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                    Continue with Google
                </button>

                <!-- GitHub Login Button -->
                <button type="button" onclick="loginWithGitHub()" class="btn" style="width:100%;padding:14px;margin-bottom:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:14px;color:white;font-weight:700;font-size:0.95rem;display:flex;align-items:center;justify-content:center;gap:12px;cursor:pointer;transition:all 0.3s ease;backdrop-filter:blur(8px);" onmouseover="this.style.background='rgba(51,51,51,0.4)';this.style.borderColor='#fafbfc'" onmouseout="this.style.background='rgba(255,255,255,0.06)';this.style.borderColor='rgba(255,255,255,0.15)'">
                    <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                    Continue with GitHub
                </button>

                <!-- Twitter Login Button -->
                <button type="button" onclick="loginWithTwitter()" class="btn" style="width:100%;padding:14px;margin-bottom:20px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:14px;color:white;font-weight:700;font-size:0.95rem;display:flex;align-items:center;justify-content:center;gap:12px;cursor:pointer;transition:all 0.3s ease;backdrop-filter:blur(8px);" onmouseover="this.style.background='rgba(29,161,242,0.15)';this.style.borderColor='#1da1f2'" onmouseout="this.style.background='rgba(255,255,255,0.06)';this.style.borderColor='rgba(255,255,255,0.15)'">
                    <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.25h-6.657l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.045 4.126H5.078z"/></svg>
                    Continue with Twitter
                </button>

                <!-- Divider -->
                <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
                    <div style="flex:1;height:1px;background:var(--border);"></div>
                    <span style="color:var(--text-muted);font-size:0.8rem;font-weight:600;">OR</span>
                    <div style="flex:1;height:1px;background:var(--border);"></div>
                </div>

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
                    const email    = document.getElementById('u-email').value.trim();
                    const pass     = document.getElementById('u-pass').value;
                    const fullName = document.getElementById('u-name').value.trim();
                    await this.register({ username: fullName, email, password: pass, role: 'citizen' });
                    const u = await this.login(email, pass);
                    // Enrich stored user with display name
                    const stored = this.getUser() || {};
                    stored.full_name = fullName;
                    localStorage.setItem('resolvit_user', JSON.stringify(stored));
                    this.hideModal();
                    showToast(`✨ Welcome to RESOLVIT, ${fullName}!`, 'success');
                    setTimeout(() => {
                        if (u.role === 'admin') window.location.href = 'admin.html';
                        else if (u.role === 'authority') window.location.href = 'authority.html';
                        else window.location.href = 'dashboard.html';
                    }, 700);
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

