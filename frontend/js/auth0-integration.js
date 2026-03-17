/**
 * RESOLVIT - Auth0 Google Login Integration
 * Uses @auth0/auth0-spa-js for Google OAuth via Auth0.
 * Works alongside existing email/password auth — does NOT replace it.
 */

const Auth0Integration = {
    // Auth0 Configuration (public client-side values — safe to expose)
    config: {
        domain: 'resolvit-ai.us.auth0.com',
        clientId: 'wBl9vRriwj4qiDMAQeyPzDAxFF5O3tvI',
        redirectUri: window.location.origin + '/index.html',
        audience: '', // Optional: set if you have an Auth0 API
        cacheLocation: 'localstorage'
    },

    _client: null,
    _initialized: false,

    /**
     * Initialize the Auth0 SPA client.
     * Called lazily when Google login is first requested.
     */
    async init() {
        if (this._initialized) return;

        try {
            // Dynamically load Auth0 SPA SDK if not already loaded
            if (typeof createAuth0Client === 'undefined') {
                await this._loadSDK();
            }

            this._client = await createAuth0Client({
                domain: this.config.domain,
                clientId: this.config.clientId,
                authorizationParams: {
                    redirect_uri: this.config.redirectUri
                },
                cacheLocation: this.config.cacheLocation
            });

            this._initialized = true;
        } catch (error) {
            console.error('[Auth0] Initialization failed:', error);
            throw error;
        }
    },

    /**
     * Dynamically load the Auth0 SPA SDK from CDN.
     */
    _loadSDK() {
        return new Promise((resolve, reject) => {
            if (typeof createAuth0Client !== 'undefined') {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdn.auth0.com/js/auth0-spa-js/2.1/auth0-spa-js.production.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load Auth0 SDK'));
            document.head.appendChild(script);
        });
    },

    /**
     * Handle the OAuth redirect callback.
     * This runs automatically on page load if the URL contains Auth0 query params.
     */
    async _handleCallback() {
        const query = window.location.search;
        if (query.includes('code=') && query.includes('state=')) {
            try {
                // Process the Auth0 callback
                await this._client.handleRedirectCallback();

                // Clean up URL (remove code/state params)
                window.history.replaceState({}, document.title, window.location.pathname);

                // Get the authenticated user profile
                const auth0User = await this._client.getUser();

                if (auth0User) {
                    // Sync with RESOLVIT backend — create or login the user
                    await this._syncWithBackend(auth0User);
                }
            } catch (error) {
                console.error('[Auth0] Callback handling failed:', error);
                if (typeof showToast === 'function') {
                    showToast('❌ Google login failed. Please try again.', 'error');
                }
            }
        }
    },

    /**
     * Sync an Auth0-authenticated user with the RESOLVIT backend.
     * Creates a new account if one doesn't exist, or logs in if it does.
     */
    async _syncWithBackend(auth0User) {
        const email = auth0User.email;
        const name = auth0User.name || auth0User.nickname || email.split('@')[0];

        try {
            // Try to login with a special Auth0 endpoint
            const response = await fetch(`${BASE_URL}/api/auth/oauth-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    name: name,
                    provider: 'google',
                    provider_id: auth0User.sub,
                    picture: auth0User.picture || ''
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || 'OAuth sync failed');
            }

            const data = await response.json();

            // Store credentials exactly like normal login
            localStorage.setItem('resolvit_token', data.access_token);
            localStorage.setItem('resolvit_user', JSON.stringify({
                id: data.user_id,
                username: data.username,
                role: data.role,
                department: data.department,
                picture: auth0User.picture || '',
                auth_provider: 'google'
            }));

            if (typeof showToast === 'function') {
                showToast(`✅ Welcome, ${data.username}!`, 'success');
            }

            // Role-based redirect
            setTimeout(() => {
                if (data.role === 'admin') window.location.href = 'admin.html';
                else if (data.role === 'authority') window.location.href = 'authority.html';
                else window.location.href = 'dashboard.html';
            }, 600);

        } catch (error) {
            console.error('[Auth0] Backend sync failed:', error);
            if (typeof showToast === 'function') {
                showToast('❌ ' + error.message, 'error');
            }
        }
    },

    /**
     * Start Google Login via Auth0 redirect.
     */
    async loginWithGoogle() {
        if (!this._client) {
            await this.init();
        }

        try {
            await this._client.loginWithRedirect({
                authorizationParams: {
                    connection: 'google-oauth2',
                    redirect_uri: this.config.redirectUri
                }
            });
        } catch (error) {
            console.error('[Auth0] Google login redirect failed:', error);
            if (typeof showToast === 'function') {
                showToast('❌ Could not start Google login.', 'error');
            }
        }
    },

    /**
     * Logout from Auth0 (also clears local session).
     */
    async logout() {
        // Clear local RESOLVIT session
        Auth.logout();

        if (this._client) {
            await this._client.logout({
                logoutParams: {
                    returnTo: window.location.origin
                }
            });
        } else {
            window.location.href = 'index.html';
        }
    },

    /**
     * Check if the user is currently authenticated via Auth0.
     */
    async isAuthenticated() {
        if (!this._client) return false;
        return await this._client.isAuthenticated();
    }
};

// Auto-handle OAuth callback on page load (only if returning from Auth0)
document.addEventListener('DOMContentLoaded', () => {
    const query = window.location.search;
    if (query.includes('code=') && query.includes('state=')) {
        // Returning from Auth0 — need to initialize and handle callback
        Auth0Integration.init().then(() => {
            Auth0Integration._handleCallback();
        }).catch(err => {
            console.error('[Auth0] Callback init failed:', err);
        });
    }
});

// Global shortcut
window.loginWithGoogle = () => Auth0Integration.loginWithGoogle();
window.Auth0Integration = Auth0Integration;
