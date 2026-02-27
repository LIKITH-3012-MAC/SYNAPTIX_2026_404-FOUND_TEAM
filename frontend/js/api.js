/**
 * RESOLVIT - API Module (api.js)
 * Base fetch wrapper with JWT injection, error handling, and retry support.
 */
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8000'
  : '/api-proxy'; // Production reverse proxy

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
          showToast('⚠️ Session expired. Please login again.');
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
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.background = type === 'error' ? '#b91c1c' : type === 'success' ? '#15803d' : 'var(--blue-900)';
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
