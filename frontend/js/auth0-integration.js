/**
 * RESOLVIT - Auth0 Google Login Integration (Finalized & Robust)
 * Uses @auth0/auth0-spa-js for Google OAuth via Auth0.
 */

const Auth0Integration = {
    // Auth0 Configuration from Global Head Object
    get config() {
        const globalConfig = window.AUTH0_CONFIG || {};
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        
        return {
            domain: globalConfig.domain || 'resolvit-ai.us.auth0.com',
            clientId: globalConfig.clientId || 'wBl9vRriwj4qiDMAQeyPzDAxFF5O3tvI',
            redirectUri: isLocal 
                ? window.location.origin + '/index.html' 
                : (globalConfig.redirectUri || 'https://resolvit-app-2026.vercel.app'),
            cacheLocation: 'localstorage'
        };
    },

    _client: null,
    _initialized: false,

    /**
     * Initialize the Auth0 SPA client.
     */
    async init() {
        // Log SDK presence as requested
        console.log('[Auth0] createAuth0Client type:', typeof createAuth0Client);

        if (this._initialized) return;

        try {
            // Safety Check: Wait for SDK to parse if load is delayed
            const waitForSDK = async (retries = 10) => {
                for (let i = 0; i < retries; i++) {
                    if (typeof createAuth0Client === 'function') return true;
                    console.warn(`[Auth0] SDK not found yet, retrying... (${i+1}/10)`);
                    await new Promise(r => setTimeout(r, 500));
                }
                return false;
            };

            if (!(await waitForSDK())) {
                const errMsg = '[Auth0] CRITICAL: createAuth0Client is not defined. SDK failed to load from CDN.';
                console.error(errMsg);
                throw new Error(errMsg);
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
            console.log('[Auth0] Client successfully initialized with Redirect URI:', this.config.redirectUri);
        } catch (error) {
            console.error('[Auth0] Initialization failed:', error);
            throw error;
        }
    },

    /**
     * Handle the OAuth redirect callback.
     */
    async _handleCallback() {
        const query = window.location.search;
        if (query.includes('code=') && query.includes('state=')) {
            console.log('[Auth0] Callback params detected. Processing redirect...');
            try {
                if (!this._client) await this.init();
                await this._client.handleRedirectCallback();
                window.history.replaceState({}, document.title, window.location.pathname);
                
                const auth0User = await this._client.getUser();
                if (auth0User) {
                    await this._syncWithBackend(auth0User);
                }
            } catch (error) {
                console.error('[Auth0] Callback error:', error);
            }
        }
    },

    /**
     * Sync authenticated user with RESOLVIT database
     */
    async _syncWithBackend(auth0User) {
        console.log('[Auth0] Syncing user with backend...', auth0User.email);
        try {
            const response = await fetch(`${BASE_URL}/api/auth/oauth-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: auth0User.email,
                    name: auth0User.name || auth0User.nickname || auth0User.email.split('@')[0],
                    provider: 'google',
                    provider_id: auth0User.sub,
                    picture: auth0User.picture || ''
                })
            });

            if (!response.ok) throw new Error('Database sync failed');

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

            if (typeof showToast === 'function') {
                showToast(`✅ Welcome, ${data.username}!`, 'success');
            }

            // Route to dashboard
            setTimeout(() => {
                if (data.role === 'admin') window.location.href = 'admin.html';
                else if (data.role === 'authority') window.location.href = 'authority.html';
                else window.location.href = 'dashboard.html';
            }, 700);

        } catch (error) {
            console.error('[Auth0] Sync failed:', error);
        }
    },

    /**
     * Trigger Google Login flow
     */
    async loginWithGoogle() {
        console.log('[Auth0] loginWithGoogle initiating...');
        
        // Find triggering button for state update
        const btn = event?.currentTarget || document.querySelector('button[onclick*="loginWithGoogle"]');
        if (btn) {
            btn.dataset.original = btn.innerHTML;
            btn.innerHTML = 'Connecting to Secure Server...';
            btn.disabled = true;
        }

        try {
            if (!this._client) await this.init();
            
            console.log('[Auth0] Calling loginWithRedirect...');
            await this._client.loginWithRedirect({
                authorizationParams: {
                    connection: 'google-oauth2',
                    redirect_uri: this.config.redirectUri
                }
            });
        } catch (error) {
            const errMsg = error.message || 'Unknown error';
            console.error('[Auth0] CRITICAL Login Initiation Failed:', error);
            alert(`Unable to start Google login.\n\nReason: ${errMsg}\n\ntypeof createAuth0Client: ${typeof createAuth0Client}`);
            
            if (btn) {
                btn.innerHTML = btn.dataset.original;
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
            await this._client.logout({ logoutParams: { returnTo: window.location.origin } });
        } else {
            window.location.href = 'index.html';
        }
    }
};

// Global hooks
document.addEventListener('DOMContentLoaded', () => Auth0Integration._handleCallback());
window.loginWithGoogle = () => Auth0Integration.loginWithGoogle();
window.Auth0Integration = Auth0Integration;
