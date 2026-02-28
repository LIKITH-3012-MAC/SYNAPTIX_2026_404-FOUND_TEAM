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
  // file:// protocol → hostname is empty string
  // localhost / 127.0.0.1 → local dev server
  if (!host || host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:8000";
  }
  // Any real domain (including Render static, Vercel, etc.) → production API
  return PRODUCTION_URL;
})();

// ────────────────────────────────────────────────────────────────
// Core API Wrapper
// ────────────────────────────────────────────────────────────────
const API = {
  async _fetch(method, path, body = null, retries = 2) {
    const token = localStorage.getItem("resolvit_token");

    const headers = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const options = { method, headers };

    if (body) {
      options.body = JSON.stringify(body);
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${BASE_URL}${path}`, options);

        if (response.status === 401) {
          localStorage.removeItem("resolvit_token");
          localStorage.removeItem("resolvit_user");
          showToast("⚠️ Session expired. Please login again.", "error");
          // Don't force-redirect — let page handle it
        }

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const msg = data.detail || data.message || `Request failed (${response.status})`;
          throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
        }

        return data;
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        // Exponential backoff between retries
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1))
        );
      }
    }
  },

  // ── Generic HTTP methods (used by auth.js, dashboard.js, issues.js, HTML pages) ──
  get: (path) => API._fetch("GET", path),
  post: (path, body) => API._fetch("POST", path, body),
  patch: (path, body) => API._fetch("PATCH", path, body),
  delete: (path) => API._fetch("DELETE", path),

  // ── Named convenience methods (optional, for cleaner call-sites) ──

  // Auth
  register(data) { return this._fetch("POST", "/api/auth/register", data); },
  login(data) { return this._fetch("POST", "/api/auth/login", data); },
  getCurrentUser() { return this._fetch("GET", "/api/auth/me"); },

  // Issues
  createIssue(data) { return this._fetch("POST", "/api/issues", data); },
  getIssues(params) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return this._fetch("GET", `/api/issues${qs}`);
  },
  getIssue(id) { return this._fetch("GET", `/api/issues/${id}`); },
  updateIssue(id, data) { return this._fetch("PATCH", `/api/issues/${id}`, data); },
  deleteIssue(id) { return this._fetch("DELETE", `/api/issues/${id}`); },

  // Metrics & Audit
  getSummary() { return this._fetch("GET", "/api/metrics/summary"); },
  getLeaderboard() { return this._fetch("GET", "/api/metrics/leaderboard"); },
  getAudit(issueId) { return this._fetch("GET", `/api/audit/${issueId}`); },

  // Admin
  getAdminStats() { return this._fetch("GET", "/api/admin/stats"); },
  listUsers(params) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return this._fetch("GET", `/api/admin/users${qs}`);
  },
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
