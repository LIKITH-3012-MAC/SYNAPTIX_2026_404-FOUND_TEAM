/**
 * RESOLVIT - Auth0 Google Login Integration (Debug Enabled)
 * Uses @auth0/auth0-spa-js for Google OAuth via Auth0.
 */

const Auth0Integration = {
    // Auth0 Configuration - Hardcoded for Vanilla JS (Vercel Env Vars not accessible in browser)
    config: {
        domain: 'resolvit-ai.us.auth0.com',
        clientId: 'wBl9vRriwj4qiDMAQeyPzDAxFF5O3tvI',
        // Use exact URI from Vercel config when in production, or localhost for dev
        redirectUri: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? window.location.origin + '/index.html'
            : 'https://resolvit-app-2026.vercel.app',
        cacheLocation: 'localstorage'
    },

    _client: null,
    _initialized: false,

    /**
     * Initialize the Auth0 SPA client.
     */
    async init() {
        console.log('[Auth0] Starting initialization...');
        if (this._initialized) return;

        // Wait up to 5 seconds for the global createAuth0Client to be available
        const waitForSDK = async (retries = 10) => {
            for (let i = 0; i < retries; i++) {
                if (typeof createAuth0Client !== 'undefined') {
                    console.log('[Auth0] SDK found in global scope.');
                    return true;
                }
                console.warn(`[Auth0] SDK not found yet, retrying... (${i+1}/10)`);
                await new Promise(r => setTimeout(r, 500));
            }
            return false;
        };

        const isLoaded = await waitForSDK();
        if (!isLoaded) {
            console.error('[Auth0] CRITICAL: Auth0 SDK (createAuth0Client) failed to load from CDN.');
            throw new Error('Auth0 SDK not loaded. Check script tag order.');
        }

        try {
            this._client = await createAuth0Client({
                domain: this.config.domain,
                clientId: this.config.clientId,
                authorizationParams: {
                    redirect_uri: this.config.redirectUri
                },
                cacheLocation: this.config.cacheLocation
            });

            this._initialized = true;
            console.log('[Auth0] Logic: Client initialized with Redirect URI:', this.config.redirectUri);
        } catch (error) {
            console.error('[Auth0] Initialization failed with error:', error);
            throw error;
        }
    },

    /**
     * Handle the OAuth redirect callback.
     */
    async _handleCallback() {
        console.log('[Auth0] Checking for callback params in URL...');
        const query = window.location.search;
        if (query.includes('code=') && query.includes('state=')) {
            console.log('[Auth0] Callback params detected. Processing...');
            try {
                if (!this._client) await this.init();
                
                await this._client.handleRedirectCallback();
                console.log('[Auth0] Callback processed successfully.');
                
                // Clean up URL
                window.history.replaceState({}, document.title, window.location.pathname);
                
                const auth0User = await this._client.getUser();
                if (auth0User) {
                    console.log('[Auth0] Authenticated user retrieved:', auth0User.email);
                    await this._syncWithBackend(auth0User);
                }
            } catch (error) {
                console.error('[Auth0] Callback processing failed:', error);
            }
        }
    },

    /**
     * Sync with RESOLVIT backend
     */
    async _syncWithBackend(auth0User) {
        const email = auth0User.email;
        const name = auth0User.name || auth0User.nickname || email.split('@')[0];

        console.log('[Auth0] Syncing user with RESOLVIT backend via OAuth Login...');
        try {
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
            console.log('[Auth0] Backend sync successful. User Role:', data.role);

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
                const role = data.role;
                if (role === 'admin') window.location.href = 'admin.html';
                else if (role === 'authority') window.location.href = 'authority.html';
                else window.location.href = 'dashboard.html';
            }, 800);

        } catch (error) {
            console.error('[Auth0] Backend sync failed:', error);
            if (typeof showToast === 'function') {
                showToast('❌ Backend sync failed: ' + error.message, 'error');
            }
        }
    },

    /**
     * Start Google Login
     */
    async loginWithGoogle(event) {
        console.log('[Auth0] Login initiated via Google button.');
        
        // Manual event capture for better browser compatibility
        const currentEvent = event || window.event;
        const btn = currentEvent?.currentTarget || currentEvent?.srcElement;

        if (btn) {
            btn.dataset.originalText = btn.innerText;
            btn.innerText = 'Connecting to Secure Server...';
            btn.disabled = true;
            btn.style.opacity = '0.7';
        }

        try {
            if (!this._client) await this.init();
            
            console.log('[Auth0] Redirecting to Auth0 LoginPage...');
            await this._client.loginWithRedirect({
                authorizationParams: {
                    connection: 'google-oauth2',
                    redirect_uri: this.config.redirectUri
                }
            });
        } catch (error) {
            console.error('[Auth0] Login Initiation CRITICAL ERROR:', error);
            alert(`Google login could not be initiated.\n\nReason: ${error.message}\n\nPlease check your console logs for details.`);
            
            // Restore button
            if (btn) {
                btn.innerText = btn.dataset.originalText || 'Continue with Google';
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }
    },

    /**
     * Logout
     */
    async logout() {
        console.log('[Auth0] Logging out...');
        localStorage.removeItem('resolvit_token');
        localStorage.removeItem('resolvit_user');
        
        if (this._client) {
            await this._client.logout({
                logoutParams: { returnTo: window.location.origin }
            });
        } else {
            window.location.href = 'index.html';
        }
    }
};

// Handle callback on load
document.addEventListener('DOMContentLoaded', () => {
    Auth0Integration._handleCallback();
});

// Global bindings
window.loginWithGoogle = (e) => Auth0Integration.loginWithGoogle(e);
window.Auth0Integration = Auth0Integration;
