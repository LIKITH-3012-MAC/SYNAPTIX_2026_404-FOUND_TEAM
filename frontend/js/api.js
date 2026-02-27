/**
 * RESOLVIT - API Module (api.js)
 * Base fetch wrapper with JWT injection, error handling, and retry support.
 *
 * CORS NOTE: When opening HTML files directly via file://, browsers send
 * Origin: null. The backend CORS config explicitly allows "null".
 * For best results, serve frontend via: npx serve frontend/ -p 5500
 */

// ── Backend URL Configuration ──────────────────────────────────
const API_BASE = (() => {
  const host = window.location.hostname;
  // - Opened via file:// in browser → null origin, target localhost:8000
  // - Served from localhost (any port) → target localhost:8000
  // - Production domain → use relative path (nginx reverse-proxy handles it)
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:8000';
  }
  return ''; // Same-origin requests for production (nginx proxies /api/*)
})();

const API = {
  /**
   * Internal fetch wrapper — injects auth token and handles errors.
   */
  async _fetch(method, path, body = null, retries = 2) {
    const token = localStorage.getItem('resolvit_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${API_BASE}${path}`, options);

        if (response.status === 401) {
          localStorage.removeItem('resolvit_token');
          localStorage.removeItem('resolvit_user');
          showToast('⚠️ Session expired. Please login again.', 'error');
          // Don't redirect here — let the page handle it
        }

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const msg = data.detail || data.message || `Request failed (${response.status})`;
          throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }

        return data;
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  },

  get:    (path)       => API._fetch('GET', path),
  post:   (path, body) => API._fetch('POST', path, body),
  patch:  (path, body) => API._fetch('PATCH', path, body),
  delete: (path)       => API._fetch('DELETE', path),
};

/* ── Toast Notification (global) ────────────────────────────── */
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    // Create if missing (pages that don't include it in HTML)
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  if (type === 'error') {
    toast.style.background = '#b91c1c';
  } else if (type === 'success') {
    toast.style.background = '#15803d';
  } else if (type === 'warning') {
    toast.style.background = '#b45309';
  } else {
    toast.style.background = 'var(--blue-900, #1e3a8a)';
  }
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
