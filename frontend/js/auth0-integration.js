/**
 * RESOLVIT - Auth0 Google Login Integration (Universal SDK Loader)
 * Uses @auth0/auth0-spa-js for Google OAuth via Auth0.
 */

const Auth0Integration = {
    // Auth0 Configuration - Loads from window.AUTH0_CONFIG for vanilla JS compatibility
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
     * Helper to get the Auth0 factory function from various build types (global, UMD/namespace)
     */
    _getCreateAuth0Client() {
        if (typeof createAuth0Client === 'function') return createAuth0Client;
        if (window.auth0 && typeof window.auth0.createAuth0Client === 'function') return window.auth0.createAuth0Client;
        return null;
    },

    /**
     * Initialize the Auth0 SPA client.
     */
    async init() {
        const conf = this.config;
        console.log('[Auth0] Initializing with config:', conf);

        if (this._initialized) return;

        // Verify SDK presence (checking global and window.auth0 namespace)
        const waitForSDK = async (retries = 15) => {
            for (let i = 0; i < retries; i++) {
                const factory = this._getCreateAuth0Client();
                if (factory) {
                    console.log('[Auth0] SDK factory found.');
                    return factory;
                }
                console.warn(`[Auth0] SDK not found yet, retrying... (${i+1}/${retries})`);
                await new Promise(r => setTimeout(r, 500));
            }
            return null;
        };

        const factory = await waitForSDK();
        if (!factory) {
            const errMsg = '[Auth0] CRITICAL: Auth0 SDK factory (createAuth0Client) is not defined. SDK failed to load or is being blocked.';
            console.error(errMsg);
            throw new Error(errMsg);
        }

        try {
            this._client = await factory({
                domain: conf.domain,
                clientId: conf.clientId,
                authorizationParams: {
                    redirect_uri: conf.redirectUri
                },
                cacheLocation: conf.cacheLocation
            });

            this._initialized = true;
            console.log('[Auth0] Client initialized. Ready for Google Login.');
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
            console.log('[Auth0] Handling authentication callback...');
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
     * Sync authenticated user with backend
     */
    async _syncWithBackend(auth0User) {
        console.log('[Auth0] Syncing user with database...');
        const provider = auth0User.sub.includes('google') ? 'google' : 
                         auth0User.sub.includes('github') ? 'github' : 
                         auth0User.sub.includes('twitter') ? 'twitter' : 'auth0';
        
        try {
            const response = await fetch(`${BASE_URL}/api/auth/oauth-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: auth0User.email,
                    name: auth0User.name || auth0User.nickname || auth0User.email.split('@')[0],
                    provider: provider,
                    provider_id: auth0User.sub,
                    picture: auth0User.picture || ''
                })
            });

            if (!response.ok) throw new Error('Backend sync failed');

            const data = await response.json();
            localStorage.setItem('resolvit_token', data.access_token);
            localStorage.setItem('resolvit_user', JSON.stringify({
                id: data.user_id,
                username: data.username,
                role: data.role,
                department: data.department,
                picture: auth0User.picture || '',
                auth_provider: provider
            }));

            if (typeof showToast === 'function') {
                showToast(`✅ Welcome back, ${data.username}!`, 'success');
            }

            // Route to target page
            setTimeout(() => {
                if (data.role === 'admin') window.location.href = 'admin.html';
                else if (data.role === 'authority') window.location.href = 'authority.html';
                else window.location.href = 'dashboard.html';
            }, 600);

        } catch (error) {
            console.error('[Auth0] Sync error:', error);
        }
    },

    /**
     * Trigger Google Login flow
     */
    async loginWithGoogle() {
        // Find existing button for state update
        const btn = event?.currentTarget || document.querySelector('button[onclick*="loginWithGoogle"]');
        if (btn) {
            btn.dataset.originalContent = btn.innerHTML;
            btn.innerHTML = 'Connecting to Secure Server...';
            btn.disabled = true;
        }

        try {
            const conf = this.config;
            console.log('[Auth0] Starting redirect with config:', conf);
            
            if (!this._client) await this.init();
            
            await this._client.loginWithRedirect({
                authorizationParams: {
                    connection: 'google-oauth2',
                    redirect_uri: conf.redirectUri
                }
            });
        } catch (error) {
            console.error('[Auth0] Login Initiation Error:', error);
            alert(`Google login failed. \n\nCause: ${error.message}\n\ntypeof window.auth0: ${typeof window.auth0}\ntypeof createAuth0Client: ${typeof createAuth0Client}`);
            
            if (btn) {
                btn.innerHTML = btn.dataset.originalContent;
                btn.disabled = false;
            }
        }
    },

    /**
     * Trigger GitHub Login flow
     */
    async loginWithGitHub() {
        const btn = event?.currentTarget || document.querySelector('button[onclick*="loginWithGitHub"]');
        if (btn) {
            btn.dataset.originalContent = btn.innerHTML;
            btn.innerHTML = 'Connecting to GitHub...';
            btn.disabled = true;
        }

        try {
            const conf = this.config;
            if (!this._client) await this.init();
            
            await this._client.loginWithRedirect({
                authorizationParams: {
                    connection: 'github',
                    redirect_uri: conf.redirectUri
                }
            });
        } catch (error) {
            console.error('[Auth0] GitHub Login Error:', error);
            if (btn) {
                btn.innerHTML = btn.dataset.originalContent;
                btn.disabled = false;
            }
        }
    },

    /**
     * Trigger Twitter Login flow
     */
    async loginWithTwitter() {
        const btn = event?.currentTarget || document.querySelector('button[onclick*="loginWithTwitter"]');
        if (btn) {
            btn.dataset.originalContent = btn.innerHTML;
            btn.innerHTML = 'Connecting to Twitter...';
            btn.disabled = true;
        }

        try {
            const conf = this.config;
            if (!this._client) await this.init();
            
            await this._client.loginWithRedirect({
                authorizationParams: {
                    connection: 'twitter',
                    redirect_uri: conf.redirectUri
                }
            });
        } catch (error) {
            console.error('[Auth0] Twitter Login Error:', error);
            if (btn) {
                btn.innerHTML = btn.dataset.originalContent;
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

// Global handlers
document.addEventListener('DOMContentLoaded', () => Auth0Integration._handleCallback());
window.loginWithGoogle = () => Auth0Integration.loginWithGoogle();
window.loginWithGitHub = () => Auth0Integration.loginWithGitHub();
window.loginWithTwitter = () => Auth0Integration.loginWithTwitter();
window.Auth0Integration = Auth0Integration;
