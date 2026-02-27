/**
 * RESOLVIT - Issues Module (issues.js)
 * Shared issue card renderer, badge helpers, and CRUD wrappers.
 */

/* ── Status/Priority Helpers ─────────────────────────────────── */
function getPriorityClass(score) {
    if (score >= 80) return 'priority-critical';
    if (score >= 60) return 'priority-high';
    if (score >= 40) return 'priority-medium';
    return 'priority-low';
}

function getPriorityLabel(score) {
    if (score >= 80) return 'Critical';
    if (score >= 60) return 'High';
    if (score >= 40) return 'Medium';
    return 'Low';
}

function getPriorityColor(score) {
    if (score >= 80) return 'var(--red)';
    if (score >= 60) return 'var(--orange)';
    if (score >= 40) return 'var(--yellow)';
    return 'var(--green)';
}

function formatRelativeDate(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);

    if (diffH < 1) return 'Just now';
    if (diffH < 24) return `${diffH}h ago`;
    if (diffD < 7) return `${diffD}d ago`;
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function buildUrgencyDots(urgency) {
    return Array.from({ length: 5 }, (_, i) =>
        `<div class="urgency-dot ${i < urgency ? 'filled' : ''}"></div>`
    ).join('');
}

/* ── Issue Card Renderer ─────────────────────────────────────── */
function renderIssueCard(issue) {
    const prioClass = getPriorityClass(issue.priority_score);
    const prioColor = getPriorityColor(issue.priority_score);
    const isEscalated = issue.status === 'escalated';

    return `
    <div class="issue-card ${prioClass}" onclick="window.location.href='issue.html?id=${issue.id}'" id="card-${issue.id}" style="position:relative;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <span class="cat-badge cat-${issue.category}">${issue.category}</span>
          <span class="badge badge-${issue.status}" style="font-size:0.7rem;">
            <div class="badge-dot"></div>${issue.status.replace('_', ' ')}
          </span>
          ${isEscalated ? '<span class="badge badge-escalated" style="font-size:0.7rem;">🚨 ESCALATED</span>' : ''}
          ${issue.cluster_id ? '<span class="badge badge-clustered" style="font-size:0.7rem;">🤖 Clustered</span>' : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div class="priority-score ${prioClass}" style="font-size:1.6rem;transition:all 0.5s;">${issue.priority_score}</div>
          <div style="font-size:0.65rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;">${getPriorityLabel(issue.priority_score)}</div>
        </div>
      </div>

      <!-- Title -->
      <h4 style="margin-bottom:8px;line-height:1.4;font-size:0.95rem;color:var(--text-primary);">${escapeHtml(issue.title)}</h4>

      <!-- Description preview -->
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:14px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(issue.description)}</p>

      <!-- Priority Bar -->
      <div class="priority-bar" style="margin-bottom:14px;">
        <div class="priority-bar-fill" style="width:${issue.priority_score}%;background:${prioColor};"></div>
      </div>

      <!-- Footer Meta -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;gap:14px;font-size:0.78rem;color:var(--text-muted);">
          <span>👥 ${(issue.impact_scale || 0).toLocaleString()} affected</span>
          <span>📅 ${issue.days_unresolved}d</span>
          ${issue.reporter_name ? `<span>👤 ${escapeHtml(issue.reporter_name)}</span>` : ''}
        </div>
        <div class="urgency-dots">${buildUrgencyDots(issue.urgency)}</div>
      </div>

      ${isEscalated ? `
        <div style="margin-top:12px;padding:8px 12px;background:#fff1f2;border-radius:8px;font-size:0.75rem;color:var(--red);display:flex;align-items:center;gap:6px;">
          <span>🚨</span> Escalated due to SLA breach — awaiting senior authority action
        </div>` : ''}
    </div>`;
}

/* ── Security ──────────────────────────────────────────────── */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ── Issues API Wrappers ─────────────────────────────────────── */
const Issues = {
    async list({ category, status, sortBy = 'priority_score', order = 'desc', limit = 50, offset = 0 } = {}) {
        let url = `/api/issues?sort_by=${sortBy}&order=${order}&limit=${limit}&offset=${offset}`;
        if (category) url += `&category=${encodeURIComponent(category)}`;
        if (status) url += `&status=${encodeURIComponent(status)}`;
        return API.get(url);
    },

    async get(id) {
        return API.get(`/api/issues/${id}`);
    },

    async create(payload) {
        return API.post('/api/issues', payload);
    },

    async update(id, payload) {
        return API.patch(`/api/issues/${id}`, payload);
    },

    async getAudit(id) {
        return API.get(`/api/audit/${id}`);
    }
};
