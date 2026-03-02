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
  if (!host || host === "localhost" || host === "127.0.0.1") {
    // If we want to force production test even on localhost:
    // return PRODUCTION_URL;
    return "http://localhost:8000";
  }
  return PRODUCTION_URL;
})();

const API = {
  // NEW: track backend status
  status: 'connecting', // 'connecting', 'online', 'waking', 'offline'

  async _fetch(method, path, body = null, retries = 3) {
    const token = localStorage.getItem("resolvit_token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("TIMEOUT")), 10000);
        });

        const fetchPromise = fetch(`${BASE_URL}${path}`, options);
        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (response.status === 401) {
          localStorage.removeItem("resolvit_token");
          localStorage.removeItem("resolvit_user");
          showToast("⚠️ Session expired. Please login again.", "error");
        }

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const msg = data.detail || data.message || `Request failed (${response.status})`;
          throw new Error(msg);
        }

        this.status = 'online';
        this._emitStatus();
        return data;

      } catch (error) {
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
      const resp = await fetch(`${BASE_URL}/api/health`);
      const data = await resp.json();
      if (data.status === 'online') {
        this.status = 'online';
      } else {
        this.status = 'waking';
      }
    } catch (e) {
      this.status = 'waking';
    }
    this._emitStatus();
  },

  get: (path) => API._fetch("GET", path),
  post: (path, body) => API._fetch("POST", path, body),
  patch: (path, body) => API._fetch("PATCH", path, body),
  delete: (path) => API._fetch("DELETE", path),

  // Legacy Named Methods (Restored for compatibility)
  getSummary: () => API._fetch("GET", "/api/metrics/summary"),
  getIssues: (params) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return API._fetch("GET", `/api/issues${qs}`);
  },
  getIssue: (id) => API._fetch("GET", `/api/issues/${id}`),
  updateIssue: (id, data) => API._fetch("PATCH", `/api/issues/${id}`, data),
  deleteIssue: (id) => API._fetch("DELETE", `/api/issues/${id}`),
  getAudit: (id) => API._fetch("GET", `/api/audit/issue/${id}`),
  getLeaderboard: () => API._fetch("GET", "/api/credits/leaderboard"),

  register: (data) => API._fetch("POST", "/api/auth/register", data),
  login: (data) => API._fetch("POST", "/api/auth/login", data, 0),
  getCurrentUser: () => API._fetch("GET", "/api/auth/me"),
  getAdminStats: () => API._fetch("GET", "/api/admin/stats"),
};

// Expose globally
window.API = API;

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
