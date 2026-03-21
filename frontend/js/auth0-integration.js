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
    
    // CRITICAL FIX: To prevent "Invalid State" errors from cross-subdomain local storage mismatches
    // we MUST use the exact running origin for the redirect callback, as long as it's whitelisted in Auth0.
    const cand = window.location.origin.replace(/\/$/, "");

    // Auth0 Callback Mismatch Debugging
    console.log("[Auth0] Config Origin:", location.origin);
    console.log("[Auth0] Config RedirectURI:", cand);

    return {
      domain: c.domain || "resolvit-ai.us.auth0.com",
      clientId: c.clientId || "wBl9vRriwj4qiDMAQeyPzDAxFF5O3tvI",
      redirectUri: cand,
      cacheLocation: "localstorage"
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

      this._client = await factory({
        domain: conf.domain,
        clientId: conf.clientId,
        cacheLocation: conf.cacheLocation,
        authorizationParams: {
          redirect_uri: conf.redirectUri
        }
      });

      return this._client;
    })();

    return this._initPromise;
  },

  async boot() {
    if (this._bootPromise) return this._bootPromise;

    this._bootPromise = (async () => {
      const client = await this.init();

      const params = new URLSearchParams(window.location.search);
      const isCallback = params.has("code") && params.has("state");

      try {
        if (isCallback) {
          console.log("[Auth0] Handling redirect callback...");
          await client.handleRedirectCallback();

          // Clean callback params immediately
          window.history.replaceState({}, document.title, window.location.pathname);

          const user = await client.getUser();
          if (user) {
            await this.syncWithBackend(user, false);
          }
        } else {
          const isAuthenticated = await client.isAuthenticated();
          if (isAuthenticated) {
            const user = await client.getUser();
            if (user) {
              const hasLocalSession = !!localStorage.getItem("resolvit_user");
              if (!hasLocalSession) {
                console.log("[Auth0] Restoring missing local session...");
                await this.syncWithBackend(user, true);
              } else {
                this.refreshNavbarOnly();
              }
            }
          } else {
            this.refreshNavbarOnly();
          }
        }
      } catch (err) {
        console.error("[Auth0] Boot/callback error:", err);
        window.history.replaceState({}, document.title, window.location.pathname);
        if (typeof showToast === "function") {
          showToast(`❌ Login failed: ${err.message}`, "error");
        }
      }
    })();

    return this._bootPromise;
  },

  async syncWithBackend(auth0User, silent = false) {
    const provider = this.detectProvider(auth0User);
    const backendBase =
      typeof BASE_URL !== "undefined"
        ? BASE_URL
        : (window.BASE_URL || "https://synaptix-2026-404-found-team.onrender.com");

    const payload = {
      email:
        auth0User.email ||
        `${auth0User.nickname || auth0User.sub.split("|").pop()}@oauth.resolvit-ai.online`,
      name:
        auth0User.name ||
        auth0User.nickname ||
        (auth0User.email ? auth0User.email.split("@")[0] : "Citizen"),
      provider,
      provider_id: auth0User.sub,
      picture: auth0User.picture || ""
    };

    const res = await fetch(`${backendBase}/api/auth/oauth-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let msg = `Backend responded ${res.status}`;
      try {
        const data = await res.json();
        msg = data.detail || msg;
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
