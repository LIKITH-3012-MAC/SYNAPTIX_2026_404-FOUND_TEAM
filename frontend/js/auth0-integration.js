/**
 * RESOLVIT - Stable Auth0 OAuth Integration (Vanilla JS)
 * Supports: Google, GitHub, Twitter/X via Auth0
 *
 * REQUIREMENTS:
 * 1. Load SDK BEFORE this file:
 *    <script src="js/libs/auth0-spa-js.production.min.js"></script>
 * 2. Inject config BEFORE SDK/init:
 *    <script>
 *      window.AUTH0_CONFIG = {
 *        domain: "resolvit-ai.us.auth0.com",
 *        clientId: "wBl9vRriwj4qiDMAQeyPzDAxFF5O3tvI",
 *        redirectUri: "https://resolvit-app-2026.vercel.app"
 *      };
 *    </script>
 * 3. Backend endpoint:
 *    POST /api/auth/oauth-login
 */

const Auth0Integration = {
  _client: null,
  _initPromise: null,
  _bootPromise: null,

  get config() {
    const c = window.AUTH0_CONFIG || {};
    
    // STRATEGY: Always use current origin for redirectUri to ensure localStorage/Session sharing
    // This fixes the "Callback URL mismatch" and "Missing state/nonce" errors.
    const currentOrigin = window.location.origin.replace(/\/$/, "");

    console.log("[Auth0] Initializing with Origin:", currentOrigin);

    return {
      domain: c.domain || "resolvit-ai.us.auth0.com",
      clientId: c.clientId || "wBl9vRriwj4qiDMAQeyPzDAxFF5O3tvI",
      redirectUri: currentOrigin,
      cacheLocation: "localstorage",
      useRefreshTokens: true // Highly recommended for SPA reliability
    };
  },

  _getFactory() {
    if (typeof createAuth0Client === "function") return createAuth0Client;
    if (window.auth0 && typeof window.auth0.createAuth0Client === "function") {
      return window.auth0.createAuth0Client;
    }
    return null;
  },

  async init() {
    if (this._client) return this._client;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      const factory = this._getFactory();
      if (!factory) {
        throw new Error(
          "Auth0 SDK not loaded. Make sure js/libs/auth0-spa-js.production.min.js is loaded before auth0-integration.js"
        );
      }

      const conf = this.config;
      console.log("[Auth0] Client creation start...");

      this._client = await factory({
        domain: conf.domain,
        clientId: conf.clientId,
        cacheLocation: conf.cacheLocation,
        useRefreshTokens: conf.useRefreshTokens,
        authorizationParams: {
          redirect_uri: conf.redirectUri
        }
      });

      console.log("[Auth0] Client creation success.");
      return this._client;
    })();

    return this._initPromise;
  },

  async boot() {
    if (this._bootPromise) return this._bootPromise;

    this._bootPromise = (async () => {
      const client = await this.init();

      // Detection: Are we returning from an Auth0 redirect?
      const params = new URLSearchParams(window.location.search);
      const isCallback = params.has("code") && params.has("state");

      try {
        if (isCallback) {
          console.log("[Auth0] Detected callback. Verifying session...");
          
          try {
            await client.handleRedirectCallback();
            console.log("[Auth0] Callback verified successfully.");
          } catch (callbackErr) {
            console.error("[Auth0] Callback verification failed:", callbackErr);
            throw new Error(`Session verification failed: ${callbackErr.message}`);
          }

          // CLEANUP: Remove code and state from URL immediately to prevent re-processing on refresh
          const cleanUrl = window.location.pathname + window.location.hash;
          window.history.replaceState({}, document.title, cleanUrl);

          const user = await client.getUser();
          if (user) {
            console.log("[Auth0] User profile fetched for sync:", user.email || user.nickname);
            await this.syncWithBackend(user, false);
          }
        } else {
          // Regular page load
          const isAuthenticated = await client.isAuthenticated();
          if (isAuthenticated) {
            const user = await client.getUser();
            if (user) {
              const hasLocalSession = !!localStorage.getItem("resolvit_user");
              if (!hasLocalSession) {
                console.log("[Auth0] Restoring missing local session for authenticated user...");
                await this.syncWithBackend(user, true);
              } else {
                this.refreshNavbarOnly();
              }
            }
          } else {
            // Not authenticated in Auth0, check if we have a stale local session
            // (In strict mode, we might want to clear local if Auth0 says no, 
            // but for now we allow database-only logins to coexist)
            this.refreshNavbarOnly();
          }
        }
      } catch (err) {
        console.error("[Auth0] Boot process intercepted error:", err);
        
        // Ensure URL is cleaned even on error if it was a callback
        if (isCallback) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        if (typeof showToast === "function") {
          showToast(`❌ Authentication Sync Failed: ${err.message}`, "error");
        }
      }
    })();

    return this._bootPromise;
  },

  async syncWithBackend(auth0User, silent = false) {
    const provider = this.detectProvider(auth0User);
    
    // Prioritize dynamically detected BASE_URL from api.js
    const backendBase = window.BASE_URL || "https://synaptix-2026-404-found-team.onrender.com";

    const payload = {
      email:
        auth0User.email ||
        `${auth0User.nickname || auth0User.sub.split("|").pop()}@oauth.resolvit.internal`,
      name:
        auth0User.name ||
        auth0User.nickname ||
        (auth0User.email ? auth0User.email.split("@")[0] : "Citizen"),
      provider,
      provider_id: auth0User.sub,
      picture: auth0User.picture || ""
    };

    console.log(`[Auth0] Syncing with Backend (${backendBase})...`, payload);

    const res = await fetch(`${backendBase}/api/auth/oauth-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let msg = `Backend error ${res.status}`;
      try {
        const data = await res.json();
        msg = data.detail || data.message || msg;
        console.error("[Auth0] Backend Sync Detailed Error:", data);
      } catch (_) {}
      throw new Error(msg);
    }

    const data = await res.json();

    localStorage.setItem("resolvit_token", data.access_token);
    localStorage.setItem(
      "resolvit_user",
      JSON.stringify({
        id: data.user_id,
        username: data.username,
        role: data.role,
        department: data.department || null,
        picture: auth0User.picture || "",
        auth_provider: provider,
        email: payload.email,
        name: payload.name
      })
    );

    this.refreshNavbarOnly();

    if (!silent && typeof showToast === "function") {
      showToast(`✅ Welcome back, ${data.username}!`, "success");
    }

    if (!silent) {
      setTimeout(() => {
        if (data.role === "admin") {
          window.location.href = "admin.html";
        } else if (data.role === "authority") {
          window.location.href = "authority.html";
        } else {
          window.location.href = "dashboard.html";
        }
      }, 500);
    }

    return data;
  },

  detectProvider(user) {
    const sub = user?.sub || "";
    if (sub.startsWith("google-oauth2|")) return "google";
    if (sub.startsWith("github|")) return "github";
    if (sub.startsWith("twitter|") || sub.startsWith("x|")) return "twitter";
    return "auth0";
  },

  refreshNavbarOnly() {
    if (typeof Auth !== "undefined" && typeof Auth.updateNavbar === "function") {
      try {
        Auth.updateNavbar();
      } catch (e) {
        console.warn("[Auth0] Navbar refresh warning:", e);
      }
    }
  },

  async login(connection, event) {
    const btn = event?.currentTarget || null;
    const oldHtml = btn ? btn.innerHTML : null;

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = "⏳ Connecting...";
      }

      const client = await this.init();
      await client.loginWithRedirect({
        authorizationParams: {
          connection,
          redirect_uri: this.config.redirectUri
        }
      });
    } catch (err) {
      console.error(`[Auth0] ${connection} login failed:`, err);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldHtml || "Continue";
      }
      if (typeof showToast === "function") {
        showToast(`❌ ${connection} login failed: ${err.message}`, "error");
      }
    }
  },

  async loginWithGoogle(event) {
    return this.login("google-oauth2", event);
  },

  async loginWithGitHub(event) {
    return this.login("github", event);
  },

  async loginWithTwitter(event) {
    return this.login("twitter", event);
  },

  async logout() {
    localStorage.removeItem("resolvit_token");
    localStorage.removeItem("resolvit_user");

    try {
      const client = await this.init();
      await client.logout({
        logoutParams: {
          returnTo: `${window.location.origin}/index.html`
        }
      });
    } catch (err) {
      console.warn("[Auth0] Logout error:", err);
      window.location.href = "index.html";
    }
  }
};

// Global handlers for inline onclick usage
window.Auth0Integration = Auth0Integration;
window.loginWithGoogle = function (e) {
  return Auth0Integration.loginWithGoogle(e);
};
window.loginWithGitHub = function (e) {
  return Auth0Integration.loginWithGitHub(e);
};
window.loginWithTwitter = function (e) {
  return Auth0Integration.loginWithTwitter(e);
};

// Boot only after DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  Auth0Integration.boot();
});
