/**
 * RESOLVIT - Auth0 OAuth Integration (Production-Ready)
 * Supports: Google, GitHub, Twitter via Auth0.
 *
 * Architecture:
 *  - Plain object (NOT IIFE) so BASE_URL from api.js is accessible as a
 *    global variable — matches the proven pattern from commit 9762355.
 *  - window.AUTH0_CONFIG injected in each page's <head> script block.
 *  - Callback handled on DOMContentLoaded (not readyState check) to avoid
 *    race conditions with the DOM not being ready.
 *  - Redirect URI must EXACTLY match Auth0 Dashboard allowed callback URLs.
 */

const Auth0Integration = {

    // ─── Config ────────────────────────────────────────────────────
    get config() {
        const gc = window.AUTH0_CONFIG || {};
        const host = window.location.hostname;
        const isLocal = !host ||
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '0.0.0.0' ||
            host.endsWith('.local');

        // CRITICAL: redirectUri MUST exactly match what is in the Auth0 Dashboard
        // "Allowed Callback URLs" field. Even a trailing slash or /index.html
        // difference will cause "invalid_redirect_uri" → redirect loop.
        const redirectUri = isLocal
            ? window.location.origin + '/index.html'     // local dev: http://127.0.0.1:3000/index.html
            : (gc.redirectUri || 'https://resolvit-app-2026.vercel.app');  // production: exact match

        return {
            domain:        gc.domain    || 'resolvit-ai.us.auth0.com',
            clientId:      gc.clientId  || 'wBl9vRriwj4qiDMAQeyPzDAxFF5O3tvI',
            redirectUri,
            cacheLocation: 'localstorage'
        };
    },

    // ─── State ─────────────────────────────────────────────────────
    _client:      null,
    _initialized: false,
    _initPromise: null,   // singleton guard — prevents double-init race

    // ─── SDK finder ────────────────────────────────────────────────
    _getFactory() {
        if (typeof createAuth0Client === 'function') return createAuth0Client;
        if (window.auth0 && typeof window.auth0.createAuth0Client === 'function')
            return window.auth0.createAuth0Client;
        return null;
    },

    // ─── Init ──────────────────────────────────────────────────────
    async init() {
        if (this._initialized && this._client) return;
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            const conf = this.config;
            console.log('[Auth0] Initializing →', conf.domain, '| redirectUri:', conf.redirectUri);

            // Wait up to 8 seconds for SDK to load (it comes from local bundle)
            let factory = null;
            for (let i = 0; i < 16; i++) {
                factory = this._getFactory();
                if (factory) break;
                console.warn(`[Auth0] SDK not ready, retrying (${i + 1}/16)…`);
                await new Promise(r => setTimeout(r, 500));
            }

            if (!factory) {
                const msg = '[Auth0] CRITICAL: createAuth0Client not found after 8s. Check js/libs/auth0-spa-js.production.min.js';
                console.error(msg);
                this._initPromise = null;
                throw new Error(msg);
            }

            try {
                this._client = await factory({
                    domain:    conf.domain,
                    clientId:  conf.clientId,
                    authorizationParams: { redirect_uri: conf.redirectUri },
                    cacheLocation: conf.cacheLocation
                });
                this._initialized = true;
                console.log('[Auth0] ✅ Client initialized.');
            } catch (err) {
                console.error('[Auth0] Init failed:', err);
                this._initPromise = null;
                throw err;
            }
        })();

        return this._initPromise;
    },

    // ─── Callback Handler ── called on DOMContentLoaded ────────────
    async _handleCallback() {
        const qs = window.location.search;

        // Handle error returned by Auth0 (e.g., access_denied, login_required)
        if (qs.includes('error=')) {
            const params = new URLSearchParams(qs);
            const errCode = params.get('error');
            const errDesc = params.get('error_description') || errCode;
            console.error('[Auth0] OAuth error response:', errCode, errDesc);
            window.history.replaceState({}, document.title, window.location.pathname);
            if (typeof showToast === 'function') {
                showToast('❌ Login failed: ' + errDesc, 'error');
            }
            return;
        }

        // Only process if this looks like an Auth0 callback
        if (!qs.includes('code=') || !qs.includes('state=')) return;

        console.log('[Auth0] OAuth callback detected — processing…');

        try {
            await this.init();
            await this._client.handleRedirectCallback();

            // Clean the URL immediately so a page refresh doesn't re-trigger
            window.history.replaceState({}, document.title, window.location.pathname);

            const auth0User = await this._client.getUser();
            if (auth0User) {
                await this._syncWithBackend(auth0User);
            } else {
                console.error('[Auth0] getUser() returned null after handleRedirectCallback');
                if (typeof showToast === 'function') {
                    showToast('❌ Login failed — could not retrieve user profile. Please try again.', 'error');
                }
            }
        } catch (err) {
            console.error('[Auth0] Callback handling failed:', err);
            // Always clean URL to prevent infinite loops
            window.history.replaceState({}, document.title, window.location.pathname);
            if (typeof showToast === 'function') {
                showToast('❌ Login callback failed: ' + err.message, 'error');
            }
        }
    },

    // ─── Backend Sync ──────────────────────────────────────────────
    async _syncWithBackend(auth0User) {
        const sub = auth0User.sub || '';
        const provider = sub.startsWith('google')  ? 'google'  :
                         sub.startsWith('github')  ? 'github'  :
                         sub.startsWith('twitter') ? 'twitter' : 'auth0';

        console.log('[Auth0] Syncing to backend. Provider:', provider, '| Email:', auth0User.email);

        // BASE_URL is defined in api.js and exposed as window.BASE_URL
        // It's also available as a plain global (const) since both scripts
        // run in the same window scope (no module bundler).
        const backendBase = (typeof BASE_URL !== 'undefined') ? BASE_URL 
                          : (window.BASE_URL || 'https://synaptix-2026-404-found-team.onrender.com');

        try {
            const res = await fetch(`${backendBase}/api/auth/oauth-login`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email:       auth0User.email,
                    name:        auth0User.name || auth0User.nickname || (auth0User.email || '').split('@')[0],
                    provider:    provider,
                    provider_id: auth0User.sub,
                    picture:     auth0User.picture || ''
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || `Backend responded ${res.status}`);
            }

            const data = await res.json();

            localStorage.setItem('resolvit_token', data.access_token);
            localStorage.setItem('resolvit_user', JSON.stringify({
                id:            data.user_id,
                username:      data.username,
                role:          data.role,
                department:    data.department || null,
                picture:       auth0User.picture || '',
                auth_provider: provider
            }));

            console.log('[Auth0] ✅ Sync complete. Role:', data.role, '| Username:', data.username);

            if (typeof showToast === 'function') {
                showToast(`✅ Welcome back, ${data.username}!`, 'success');
            }

            // Role-based redirect
            setTimeout(() => {
                if      (data.role === 'admin')     window.location.href = 'admin.html';
                else if (data.role === 'authority') window.location.href = 'authority.html';
                else                                window.location.href = 'dashboard.html';
            }, 600);

        } catch (err) {
            console.error('[Auth0] Backend sync failed:', err);
            if (typeof showToast === 'function') {
                showToast('❌ Sign-in error: ' + err.message, 'error');
            }
        }
    },

    // ─── Google Login ──────────────────────────────────────────────
    async loginWithGoogle() {
        const btn = event?.currentTarget || document.querySelector('button[onclick*="loginWithGoogle"]');
        if (btn) { btn._orig = btn.innerHTML; btn.innerHTML = '⏳ Connecting…'; btn.disabled = true; }
        const restore = () => { if (btn) { btn.innerHTML = btn._orig || btn.innerHTML; btn.disabled = false; } };

        try {
            if (!this._client) await this.init();
            await this._client.loginWithRedirect({
                authorizationParams: {
                    connection:   'google-oauth2',
                    redirect_uri: this.config.redirectUri
                }
            });
            // Page redirects — no restore
        } catch (err) {
            console.error('[Auth0] Google login failed:', err);
            restore();
            if (typeof showToast === 'function') showToast('❌ Google login failed: ' + err.message, 'error');
            else alert('Google login failed: ' + err.message);
        }
    },

    // ─── GitHub Login ──────────────────────────────────────────────
    async loginWithGitHub() {
        const btn = event?.currentTarget || document.querySelector('button[onclick*="loginWithGitHub"]');
        if (btn) { btn._orig = btn.innerHTML; btn.innerHTML = '⏳ Connecting…'; btn.disabled = true; }
        const restore = () => { if (btn) { btn.innerHTML = btn._orig || btn.innerHTML; btn.disabled = false; } };

        try {
            if (!this._client) await this.init();
            await this._client.loginWithRedirect({
                authorizationParams: {
                    connection:   'github',
                    redirect_uri: this.config.redirectUri
                }
            });
        } catch (err) {
            console.error('[Auth0] GitHub login failed:', err);
            restore();
            if (typeof showToast === 'function') showToast('❌ GitHub login failed: ' + err.message, 'error');
        }
    },

    // ─── Twitter Login ─────────────────────────────────────────────
    // Requires Twitter connection to be configured in Auth0 dashboard.
    async loginWithTwitter() {
        const btn = event?.currentTarget || document.querySelector('button[onclick*="loginWithTwitter"]');
        if (btn) { btn._orig = btn.innerHTML; btn.innerHTML = '⏳ Connecting…'; btn.disabled = true; }
        const restore = () => { if (btn) { btn.innerHTML = btn._orig || btn.innerHTML; btn.disabled = false; } };

        try {
            if (!this._client) await this.init();
            await this._client.loginWithRedirect({
                authorizationParams: {
                    connection:   'twitter',
                    redirect_uri: this.config.redirectUri
                }
            });
        } catch (err) {
            console.error('[Auth0] Twitter login failed:', err);
            restore();
            if (typeof showToast === 'function') showToast('❌ Twitter login failed: ' + err.message, 'error');
        }
    },

    // ─── Logout ────────────────────────────────────────────────────
    async logout() {
        localStorage.removeItem('resolvit_token');
        localStorage.removeItem('resolvit_user');
        if (this._client) {
            try {
                await this._client.logout({
                    logoutParams: { returnTo: window.location.origin + '/index.html' }
                });
            } catch (e) {
                console.warn('[Auth0] Logout error:', e);
                window.location.href = 'index.html';
            }
        } else {
            window.location.href = 'index.html';
        }
    }
};

// ─── Global bindings for inline onclick handlers ────────────────
// Using regular function (not arrow) so 'event' is the real DOM event
window.loginWithGoogle  = function() { Auth0Integration.loginWithGoogle(); };
window.loginWithGitHub  = function() { Auth0Integration.loginWithGitHub(); };
window.loginWithTwitter = function() { Auth0Integration.loginWithTwitter(); };
window.Auth0Integration = Auth0Integration;

// ─── Fire callback handler AFTER DOM is ready ──────────────────
// DOMContentLoaded is the proven pattern from commit 9762355.
// DO NOT use readyState check here — it causes premature execution
// before Auth.updateNavbar() and showToast() are bound.
document.addEventListener('DOMContentLoaded', () => Auth0Integration._handleCallback());
