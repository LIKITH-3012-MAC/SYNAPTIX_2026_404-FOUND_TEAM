/**
 * RESOLVIT - API Module (api.js)
 * Production-ready fetch wrapper with JWT support
 */

const BASE_URL = "https://synaptix-2026-404-found-team.onrender.com";

const API = {

  async _fetch(method, path, body = null) {
    const token = localStorage.getItem("resolvit_token");

    const headers = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const options = {
      method: method,   // 🔥 THIS IS CRITICAL
      headers: headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${path}`, options);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Request failed (${response.status}): ${text}`);
    }

    return response.json();
  },

  // ✅ EXPLICIT METHOD WRAPPERS

  get(path) {
    return this._fetch("GET", path);
  },

  post(path, body) {
    return this._fetch("POST", path, body);
  },

  put(path, body) {
    return this._fetch("PUT", path, body);
  },

  delete(path) {
    return this._fetch("DELETE", path);
  }

};
