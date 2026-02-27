/**
 * RESOLVIT - API Module (api.js)
 * Production-ready fetch wrapper with JWT support + retry handling
 */

// ────────────────────────────────────────────────────────────────
// Backend URL (Render Production)
// ────────────────────────────────────────────────────────────────
const BASE_URL = "https://synaptix-2026-404-found-team.onrender.com";

// ────────────────────────────────────────────────────────────────
// API Wrapper
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

    const options = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${BASE_URL}${path}`, options);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));

          // Auto logout on unauthorized
          if (response.status === 401) {
            localStorage.removeItem("resolvit_token");
            window.location.href = "index.html";
          }

          throw new Error(errorData.detail || "Request failed");
        }

        return await response.json();
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }

        // Retry delay (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1))
        );
      }
    }
  },

  // ───────── AUTH ─────────
  register(data) {
    return this._fetch("POST", "/api/register", data);
  },

  login(data) {
    return this._fetch("POST", "/api/login", data);
  },

  getCurrentUser() {
    return this._fetch("GET", "/api/me");
  },

  // ───────── ISSUES ─────────
  createIssue(data) {
    return this._fetch("POST", "/api/issues", data);
  },

  getIssues() {
    return this._fetch("GET", "/api/issues");
  },

  getIssue(id) {
    return this._fetch("GET", `/api/issues/${id}`);
  },

  updateIssue(id, data) {
    return this._fetch("PUT", `/api/issues/${id}`, data);
  },

  deleteIssue(id) {
    return this._fetch("DELETE", `/api/issues/${id}`);
  },

  // ───────── ADMIN ─────────
  getMetrics() {
    return this._fetch("GET", "/api/admin/metrics");
  },
};

window.API = API;
