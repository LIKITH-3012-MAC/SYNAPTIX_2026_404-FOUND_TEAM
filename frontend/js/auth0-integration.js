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

        // CRITICAL: redirectUri MUST exactly match what is in the Auth0 Dashboard.
        // We favor root origin for production to keep it simple and consistent.
        const redirectUri = isLocal
            ? window.location.origin + '/index.html'
            : (gc.redirectUri || window.location.origin.replace(/\/$/, ''));

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

    // ─── Callback & Session Handler ──────────────────────────────
    // Unified handler for both initial OAuth callback and silent persistence.
    // Replaces previous separate _handleCallback and checkSession logic.
    async restoreSession() {
        if (this._bootPromise) return this._bootPromise;

        this._bootPromise = (async () => {
            await this.init();

            const qs = window.location.search;
            const isCallback = qs.includes('code=') && qs.includes('state=');

            try {
                if (isCallback) {
                    // 1. Process OAuth Handshake
                    console.log('[Auth0] Processing OAuth callback…');
                    await this._client.handleRedirectCallback();
                    
                    // Clean URL immediately to prevent re-processing on refresh
                    window.history.replaceState({}, document.title, window.location.pathname);
                    
                    const user = await this._client.getUser();
                    if (user) await this._executeSync(user, { silent: false });
                } else {
                    // 2. Silent Session Check (Silent Sync)
                    const authenticated = await this._client.isAuthenticated();
                    if (authenticated) {
                        const user = await this._client.getUser();
                        const localUser = localStorage.getItem('resolvit_user');
                        
                        // Sync if missing local session or mismatched
                        if (user && !localUser) {
                            console.log('[Auth0] Session found but local storage empty — restoring…');
                            await this._executeSync(user, { silent: true });
                        }
                    }
                }
            } catch (err) {
                console.error('[Auth0] Restore session failed:', err);
                if (isCallback) {
                    window.history.replaceState({}, document.title, window.location.pathname);
                    if (typeof showToast === 'function') showToast('❌ Login failed: ' + err.message, 'error');
                }
            }
        })();

        return this._bootPromise;
    },

    // Legacy naming match for index.html/dashboard.html listeners
    async _handleCallback() { return this.restoreSession(); },
    async checkSession() { return this.restoreSession(); },

    // ─── Backend Sync ──────────────────────────────────────────────
    async _syncWithBackend(auth0User) {
        return this._executeSync(auth0User, { silent: false });
    },

    async _executeSync(auth0User, { silent = false } = {}) {
        const sub = auth0User.sub || '';
        const provider = sub.startsWith('google')  ? 'google'  :
                         sub.startsWith('github')  ? 'github'  :
                         sub.startsWith('twitter') ? 'twitter' : 'auth0';

        const backendBase = (typeof BASE_URL !== 'undefined') ? BASE_URL 
                          : (window.BASE_URL || 'https://synaptix-2026-404-found-team.onrender.com');

        try {
            const res = await fetch(`${backendBase}/api/auth/oauth-login`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // Surrogate email for providers (like GitHub) that may not expose a public email.
                    // This prevents the backend from rejecting the login with a 422 Unprocessable Entity.
                    email:       auth0User.email || `${auth0User.nickname || auth0User.sub.split('|').pop()}@oauth.resolvit.internal`,
                    name:        auth0User.name || auth0User.nickname || (auth0User.email || 'Citizen').split('@')[0],
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

            console.log(`[Auth0] ✅ ${silent ? 'Restoration' : 'Sync'} complete.`, data.username);

            // Update UI immediate notification if reachable
            if (typeof Auth !== 'undefined' && Auth.updateNavbar) {
                Auth.updateNavbar();
            }

            if (!silent && typeof showToast === 'function') {
                showToast(`✅ Welcome back, ${data.username}!`, 'success');
            }

            // Role-based redirect only if NOT silent
            if (!silent) {
                setTimeout(() => {
                    if      (data.role === 'admin')     window.location.href = 'admin.html';
                    else if (data.role === 'authority') window.location.href = 'authority.html';
                    else                                window.location.href = 'dashboard.html';
                }, 600);
            }

        } catch (err) {
            console.error('[Auth0] Sync failed:', err);
            if (!silent && typeof showToast === 'function') {
                showToast('❌ Sign-in error: ' + err.message, 'error');
            }
        }
    },

    // ─── Google Login ──────────────────────────────────────────────
    async loginWithGoogle(e) {
        const target = e?.currentTarget || (typeof event !== 'undefined' ? event.currentTarget : null) || document.querySelector('button[onclick*="loginWithGoogle"]');
        if (target) { target._orig = target.innerHTML; target.innerHTML = '⏳ Connecting…'; target.disabled = true; }
        const restore = () => { if (target) { target.innerHTML = target._orig || target.innerHTML; target.disabled = false; } };

        try {
            await this.init();
            await this._client.loginWithRedirect({
                authorizationParams: {
                    connection:   'google-oauth2',
                    redirect_uri: this.config.redirectUri
                }
            });
        } catch (err) {
            console.error('[Auth0] Google login failed:', err);
            restore();
            if (typeof showToast === 'function') showToast('❌ Google login failed: ' + err.message, 'error');
        }
    },

    // ─── GitHub Login ──────────────────────────────────────────────
    async loginWithGitHub(e) {
        const target = e?.currentTarget || (typeof event !== 'undefined' ? event.currentTarget : null) || document.querySelector('button[onclick*="loginWithGitHub"]');
        if (target) { target._orig = target.innerHTML; target.innerHTML = '⏳ Connecting…'; target.disabled = true; }
        const restore = () => { if (target) { target.innerHTML = target._orig || target.innerHTML; target.disabled = false; } };

        try {
            await this.init();
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
    async loginWithTwitter(e) {
        const target = e?.currentTarget || (typeof event !== 'undefined' ? event.currentTarget : null) || document.querySelector('button[onclick*="loginWithTwitter"]');
        if (target) { target._orig = target.innerHTML; target.innerHTML = '⏳ Connecting…'; target.disabled = true; }
        const restore = () => { if (target) { target.innerHTML = target._orig || target.innerHTML; target.disabled = false; } };

        try {
            await this.init();
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
window.loginWithGoogle  = function(e) { Auth0Integration.loginWithGoogle(e); };
window.loginWithGitHub  = function(e) { Auth0Integration.loginWithGitHub(e); };
window.loginWithTwitter = function(e) { Auth0Integration.loginWithTwitter(e); };
window.Auth0Integration = Auth0Integration;

// ─── Fire callback handler AFTER DOM is ready ──────────────────
// DOMContentLoaded is the proven pattern from commit 9762355.
// DO NOT use readyState check here — it causes premature execution
// before Auth.updateNavbar() and showToast() are bound.
document.addEventListener('DOMContentLoaded', () => Auth0Integration._handleCallback());
