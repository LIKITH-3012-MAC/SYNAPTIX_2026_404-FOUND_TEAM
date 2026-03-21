/**
 * RESOLVIT - API Module (api.js)
 * Production-ready fetch wrapper with JWT support + retry handling
 *
 * Auto-detects environment:
 *   - file:// or localhost → http://localhost:8000 (local dev)
 *   - Any other hostname  → Render production backend
 */

// ────────────────────────────────────────────────────────────────
// Backend URL — auto-switches dev ↔ production
// ────────────────────────────────────────────────────────────────
const PRODUCTION_URL = "https://synaptix-2026-404-found-team.onrender.com";

const BASE_URL = (() => {
  const host = window.location.hostname;
  const isLocal = !host || host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.");

  if (isLocal) {
    if (window.location.port === "8000") return ""; // Origin-relative
    return "http://127.0.0.1:8000";
  }
  return PRODUCTION_URL;
})();

const API = {
  BASE_URL,
  // NEW: track backend status
  status: 'connecting', // 'connecting', 'online', 'waking', 'offline'

  async _fetch(method, path, body = null, retries = 3, options = {}) {
    const token = localStorage.getItem("resolvit_token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const fetchOptions = { 
        method, 
        headers, 
        signal: options.signal // Support for AbortController
    };
    if (body) fetchOptions.body = JSON.stringify(body);

    const isSilent = !!options.silent;


    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("TIMEOUT")), 60000);
        });

        const fetchPromise = fetch(`${BASE_URL}${path}`, fetchOptions);
        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (response.status === 401 && !path.includes("/api/auth/login")) {
          localStorage.removeItem("resolvit_token");
          localStorage.removeItem("resolvit_user");
          if (!isSilent) showToast("⚠️ Session expired. Please login again.", "error");
        }

        const data = await response.json().catch(() => ({}));


        if (!response.ok) {
          let msg = `Request failed (${response.status})`;
          if (Array.isArray(data.detail)) {
            msg = data.detail.map(e => typeof e === 'string' ? e : e.msg).join(" | ");
          } else if (data.detail) {
            msg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
          } else if (data.message) {
            msg = data.message;
          }
          const err = new Error(msg);
          err.status = response.status;
          throw err;
        }

        this.status = 'online';
        this._emitStatus();
        return (data && data.success === true && data.data !== undefined) ? data.data : data;

      } catch (error) {
        if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
          this.status = 'online';
          this._emitStatus();
          throw error;
        }

        if (error.message === "TIMEOUT" || error.name === "AbortError" || error.message.includes("failed to fetch")) {
          this.status = 'waking'; // Probably Render cold start
          this._emitStatus();
        }

        if (attempt === retries) {
          this.status = 'offline';
          this._emitStatus();
          throw error;
        }

        // Exponential backoff
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  },

  _emitStatus() {
    window.dispatchEvent(new CustomEvent('resolvit-api-status', { detail: this.status }));
  },

  async checkHealth() {
    try {
      const resp = await fetch(`${BASE_URL}/api/health`, { cache: 'no-store' });
      if (!resp.ok) { 
        if (this.status !== 'waking') {
            console.log("[API] Backend is waking up (Render cold start)...");
            this.status = 'waking'; 
            this._emitStatus(); 
        }
        return; 
      }
      const data = await resp.json();
      const prevStatus = this.status;
      this.status = (data.status === 'online' || data.status === 'RESOLVIT API running' || data.success) ? 'online' : 'waking';
      if (prevStatus !== 'online' && this.status === 'online') {
          console.log("[API] Connection verified. System online.");
      }
    } catch (e) {
      if (this.status !== 'waking' && !BASE_URL.includes('localhost')) {
          console.warn("[API] Connection interrupted. Backend may be offline or waking.");
          this.status = 'waking';
      } else if (BASE_URL.includes('localhost')) {
          this.status = 'offline';
      }
    }
    this._emitStatus();
  },


  get: (path, options) => API._fetch("GET", path, null, 3, options),
  post: (path, body, options) => API._fetch("POST", path, body, 3, options),
  patch: (path, body, options) => API._fetch("PATCH", path, body, 3, options),
  delete: (path, options) => API._fetch("DELETE", path, null, 3, options),

  // Legacy Named Methods (Restored for compatibility)
  getSummary: () => API._fetch("GET", "/api/metrics/summary"),
  getIssues: (params = {}) => {
    // Filter out null/undefined to avoid "?category=undefined"
    const cleaned = Object.fromEntries(
      Object.entries(params).filter(([_, v]) => v != null && v !== "")
    );
    const qs = Object.keys(cleaned).length ? "?" + new URLSearchParams(cleaned).toString() : "";
    return API._fetch("GET", `/api/issues${qs}`);
  },
  getIssue: (id) => API._fetch("GET", `/api/issues/${id}`),
  updateIssue: (id, data) => API._fetch("PATCH", `/api/issues/${id}`, data),
  deleteIssue: (id) => API._fetch("DELETE", `/api/issues/${id}`),
  getAudit: (id) => API._fetch("GET", `/api/audit/${id}`),
  getLeaderboard: () => API._fetch("GET", "/api/credits/leaderboard"),

  register: (data) => API._fetch("POST", "/api/auth/register", data),
  login: (data) => API._fetch("POST", "/api/auth/login", data, 0),
  getCurrentUser: () => API._fetch("GET", "/api/auth/me"),
  getAdminStats: () => API._fetch("GET", "/api/admin/stats"),
};

// Expose globally
window.API = API;
window.BASE_URL = BASE_URL; // expose for auth0-integration.js + any legacy refs

// ────────────────────────────────────────────────────────────────
// Toast Notification — global utility used across ALL pages
// ────────────────────────────────────────────────────────────────
function showToast(message, type = "info", duration = 4000) {
  let container = document.getElementById("toast-container");
  if (!container) {
    // Auto-create if the page didn't include it in HTML
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "toast";

  const colors = {
    error: "#b91c1c",
    success: "#15803d",
    warning: "#b45309",
    info: "var(--blue-900, #1e3a8a)",
  };
  toast.style.background = colors[type] || colors.info;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "slideInRight 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
