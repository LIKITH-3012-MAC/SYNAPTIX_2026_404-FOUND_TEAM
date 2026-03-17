/**
 * RESOLVIT - Auth0 OAuth Integration (Production-Ready)
 * Full support: Google, GitHub, Twitter via Auth0.
 * Uses @auth0/auth0-spa-js (local UMD bundle).
 *
 * Architecture notes:
 *  - window.AUTH0_CONFIG injected in each HTML page's <head>
 *  - BASE_URL resolved from window.APP_BASE_URL (set by api.js before this runs)
 *    OR falls back to environment detection here.
 *  - loginWith* functions set on window for inline onclick compatibility.
 */

const Auth0Integration = (() => {
    // ─── Config ────────────────────────────────────────────────
    function getConfig() {
        const gc = window.AUTH0_CONFIG || {};
        const isLocal = !window.location.hostname ||
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1' ||
            window.location.hostname === '0.0.0.0';

        return {
            domain:      gc.domain    || 'resolvit-ai.us.auth0.com',
            clientId:    gc.clientId  || 'wBl9vRriwj4qiDMAQeyPzDAxFF5O3tvI',
            redirectUri: isLocal
                ? window.location.origin + '/index.html'
                : (gc.redirectUri || 'https://resolvit-app-2026.vercel.app/index.html'),
            cacheLocation: 'localstorage'
        };
    }

    // ─── Resolve backend base URL without depending on api.js load order ──
    function getBackendUrl() {
        if (window.BASE_URL) return window.BASE_URL;             // set by api.js
        if (window.APP_BASE_URL) return window.APP_BASE_URL;
        const host = window.location.hostname;
        const isLocal = !host || host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
        return isLocal
            ? 'http://127.0.0.1:8000'
            : 'https://synaptix-2026-404-found-team.onrender.com';
    }

    // ─── SDK loader ────────────────────────────────────────────
    function getSdkFactory() {
        if (typeof createAuth0Client === 'function') return createAuth0Client;
        if (window.auth0 && typeof window.auth0.createAuth0Client === 'function')
            return window.auth0.createAuth0Client;
        return null;
    }

    // ─── Private state ─────────────────────────────────────────
    let _client       = null;
    let _initialized  = false;
    let _initPromise  = null;   // prevent double-init race

    // ─── Init ──────────────────────────────────────────────────
    async function init() {
        if (_initialized && _client) return;
        if (_initPromise) return _initPromise;

        _initPromise = (async () => {
            const conf = getConfig();
            console.log('[Auth0] Initializing →', conf.domain, '| redirectUri:', conf.redirectUri);

            // Wait up to 8 seconds for SDK to load
            let factory = null;
            for (let i = 0; i < 16; i++) {
                factory = getSdkFactory();
                if (factory) break;
                console.warn(`[Auth0] SDK not ready, retrying (${i + 1}/16)…`);
                await new Promise(r => setTimeout(r, 500));
            }

            if (!factory) {
                const msg = '[Auth0] CRITICAL: SDK (createAuth0Client) never loaded. Check that js/libs/auth0-spa-js.production.min.js is reachable.';
                console.error(msg);
                throw new Error(msg);
            }

            try {
                _client = await factory({
                    domain:    conf.domain,
                    clientId:  conf.clientId,
                    authorizationParams: { redirect_uri: conf.redirectUri },
                    cacheLocation: conf.cacheLocation
                });
                _initialized = true;
                console.log('[Auth0] ✅ Client initialized.');
            } catch (err) {
                console.error('[Auth0] Init failed:', err);
                _initPromise = null;
                throw err;
            }
        })();

        return _initPromise;
    }

    // ─── OAuth Redirect Callback Handler ──────────────────────
    async function handleCallback() {
        const qs = window.location.search;
        const hasCode  = qs.includes('code=');
        const hasState = qs.includes('state=');
        const hasError = qs.includes('error=');

        if (hasError) {
            const params = new URLSearchParams(qs);
            console.error('[Auth0] OAuth error:', params.get('error'), params.get('error_description'));
            window.history.replaceState({}, document.title, window.location.pathname);
            if (typeof showToast === 'function') {
                showToast('❌ Login failed: ' + (params.get('error_description') || params.get('error')), 'error');
            }
            return;
        }

        if (!hasCode || !hasState) return;   // no callback in progress

        console.log('[Auth0] Callback detected — processing…');
        try {
            await init();
            await _client.handleRedirectCallback();
            window.history.replaceState({}, document.title, window.location.pathname);

            const auth0User = await _client.getUser();
            if (auth0User) {
                await syncWithBackend(auth0User);
            } else {
                console.error('[Auth0] getUser() returned null after callback');
            }
        } catch (err) {
            console.error('[Auth0] Callback handling failed:', err);
            window.history.replaceState({}, document.title, window.location.pathname);
            if (typeof showToast === 'function') {
                showToast('❌ Login callback failed. Please try again.', 'error');
            }
        }
    }

    // ─── Backend Sync ──────────────────────────────────────────
    async function syncWithBackend(auth0User) {
        const sub = auth0User.sub || '';
        const provider = sub.startsWith('google')  ? 'google'  :
                         sub.startsWith('github')  ? 'github'  :
                         sub.startsWith('twitter') ? 'twitter' : 'auth0';

        console.log('[Auth0] Syncing user to backend. Provider:', provider, '| Email:', auth0User.email);

        const backendUrl = getBackendUrl();

        try {
            const res = await fetch(`${backendUrl}/api/auth/oauth-login`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    email:       auth0User.email,
                    name:        auth0User.name || auth0User.nickname || (auth0User.email || '').split('@')[0],
                    provider:    provider,
                    provider_id: auth0User.sub,
                    picture:     auth0User.picture || ''
                })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `Backend returned ${res.status}`);
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

            console.log('[Auth0] ✅ Sync complete. Role:', data.role);
            if (typeof showToast === 'function') {
                showToast(`✅ Welcome, ${data.username}!`, 'success');
            }

            // Role-based redirect (delay to let toast show)
            setTimeout(() => {
                if      (data.role === 'admin')     window.location.href = 'admin.html';
                else if (data.role === 'authority') window.location.href = 'authority.html';
                else                                window.location.href = 'dashboard.html';
            }, 700);

        } catch (err) {
            console.error('[Auth0] Backend sync failed:', err);
            if (typeof showToast === 'function') {
                showToast('❌ Could not complete sign-in: ' + err.message, 'error');
            }
        }
    }

    // ─── Generic redirect login ────────────────────────────────
    async function loginWithProvider(connection, btnEl) {
        if (btnEl) {
            btnEl._origHTML    = btnEl.innerHTML;
            btnEl.innerHTML    = '<span style="display:inline-flex;align-items:center;gap:8px;">⏳ Connecting…</span>';
            btnEl.disabled     = true;
        }

        const restore = () => {
            if (btnEl) { btnEl.innerHTML = btnEl._origHTML || btnEl.innerHTML; btnEl.disabled = false; }
        };

        try {
            await init();
            const conf = getConfig();
            await _client.loginWithRedirect({
                authorizationParams: {
                    connection:   connection,
                    redirect_uri: conf.redirectUri
                }
            });
            // Page will redirect — no restore needed
        } catch (err) {
            console.error(`[Auth0] loginWithProvider(${connection}) failed:`, err);
            restore();
            if (typeof showToast === 'function') {
                showToast(`❌ ${connection} login failed: ${err.message}`, 'error');
            } else {
                alert(`Login failed (${connection}): ${err.message}`);
            }
        }
    }

    // ─── Public API ────────────────────────────────────────────
    return {
        get _client() { return _client; },

        init,
        handleCallback,
        syncWithBackend,

        async loginWithGoogle(btnEl) {
            await loginWithProvider('google-oauth2', btnEl);
        },

        async loginWithGitHub(btnEl) {
            await loginWithProvider('github', btnEl);
        },

        /**
         * Twitter / X — Auth0 connection name is 'twitter'.
         * If the connection is not enabled in your Auth0 dashboard,
         * this will fail gracefully and show an error toast.
         */
        async loginWithTwitter(btnEl) {
            await loginWithProvider('twitter', btnEl);
        },

        async logout() {
            localStorage.removeItem('resolvit_token');
            localStorage.removeItem('resolvit_user');
            if (_client) {
                try {
                    await _client.logout({
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
})();

// ─── Global function bindings (for inline onclick compatibility) ──
// We pass 'this' (the button element) so the handler can update its state.
window.loginWithGoogle  = function() { Auth0Integration.loginWithGoogle(this); };
window.loginWithGitHub  = function() { Auth0Integration.loginWithGitHub(this); };
window.loginWithTwitter = function() { Auth0Integration.loginWithTwitter(this); };
window.Auth0Integration = Auth0Integration;

// ─── Run callback handler on page load ────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Auth0Integration.handleCallback());
} else {
    Auth0Integration.handleCallback();
}
