/**
 * RESOLVIT - Auth0 Google Login Integration (Fixed)
 * Uses @auth0/auth0-spa-js for Google OAuth via Auth0.
 */

const Auth0Integration = {
    // Auth0 Configuration
    config: {
        domain: 'resolvit-ai.us.auth0.com',
        clientId: 'wBl9vRriwj4qiDMAQeyPzDAxFF5O3tvI',
        redirectUri: 'https://resolvit-app-2026.vercel.app', // Hardcoded as per Vercel config
        cacheLocation: 'localstorage'
    },

    _client: null,
    _initialized: false,

    /**
     * Initialize the Auth0 SPA client.
     */
    async init() {
        if (this._initialized) return;

        // Wait up to 5 seconds for the global createAuth0Client to be available
        const waitForSDK = async (retries = 10) => {
            for (let i = 0; i < retries; i++) {
                if (typeof createAuth0Client !== 'undefined') return true;
                await new Promise(r => setTimeout(r, 500));
            }
            return false;
        };

        const isLoaded = await waitForSDK();
        if (!isLoaded) {
            console.error('[Auth0] SDK not found after waiting.');
            throw new Error('Auth0 SDK not loaded.');
        }

        try {
            this._client = await createAuth0Client({
                domain: this.config.domain,
                clientId: this.config.clientId,
                authorizationParams: {
                    redirect_uri: window.location.origin.includes('localhost') ? 
                                 window.location.origin + '/index.html' : 
                                 this.config.redirectUri
                },
                cacheLocation: this.config.cacheLocation
            });

            this._initialized = true;
            console.log('[Auth0] Initialized successfully');
        } catch (error) {
            console.error('[Auth0] Initialization error:', error);
            throw error;
        }
    },

    /**
     * Handle the OAuth redirect callback.
     */
    async _handleCallback() {
        if (!this._client) await this.init();

        const query = window.location.search;
        if (query.includes('code=') && query.includes('state=')) {
            try {
                await this._client.handleRedirectCallback();
                window.history.replaceState({}, document.title, window.location.pathname);
                
                const auth0User = await this._client.getUser();
                if (auth0User) {
                    await this._syncWithBackend(auth0User);
                }
            } catch (error) {
                console.error('[Auth0] Callback failed:', error);
            }
        }
    },

    /**
     * Sync with RESOLVIT backend
     */
    async _syncWithBackend(auth0User) {
        const email = auth0User.email;
        const name = auth0User.name || auth0User.nickname || email.split('@')[0];

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

            localStorage.setItem('resolvit_token', data.access_token);
            localStorage.setItem('resolvit_user', JSON.stringify({
                id: data.user_id,
                username: data.username,
                role: data.role,
                department: data.department,
                picture: auth0User.picture || '',
                auth_provider: 'google'
            }));

            // Force UI update
            if (typeof Auth !== 'undefined' && Auth.updateNavbar) {
                Auth.updateNavbar();
            }

            // Role-based redirect
            setTimeout(() => {
                const role = data.role;
                if (role === 'admin') window.location.href = 'admin.html';
                else if (role === 'authority') window.location.href = 'authority.html';
                else window.location.href = 'dashboard.html';
            }, 600);

        } catch (error) {
            console.error('[Auth0] Sync failed:', error);
        }
    },

    /**
     * Start Google Login
     */
    async loginWithGoogle() {
        try {
            // Visual feedback on button
            const btn = event?.currentTarget;
            if (btn) {
                const originalText = btn.innerText;
                btn.innerText = 'Connecting...';
                btn.disabled = true;
            }

            if (!this._client) await this.init();
            
            await this._client.loginWithRedirect({
                authorizationParams: {
                    connection: 'google-oauth2',
                    redirect_uri: window.location.origin.includes('localhost') ? 
                                 window.location.origin + '/index.html' : 
                                 this.config.redirectUri
                }
            });
        } catch (error) {
            console.error('[Auth0] Login failed:', error);
            alert('Google login could not be initiated. Check your internet connection or try again later.');
            
            // Restore button
            const btn = event?.currentTarget;
            if (btn) {
                btn.innerText = 'Continue with Google';
                btn.disabled = false;
            }
        }
    },

    /**
     * Logout
     */
    async logout() {
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
    const query = window.location.search;
    if (query.includes('code=') && query.includes('state=')) {
        Auth0Integration._handleCallback();
    }
});

// Global bindings
window.loginWithGoogle = (e) => Auth0Integration.loginWithGoogle(e);
window.Auth0Integration = Auth0Integration;
