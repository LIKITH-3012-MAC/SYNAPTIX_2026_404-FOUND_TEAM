/**
 * RESOLVIT - issues.js v2
 * Enhanced issue card renderer with:
 * - SLA countdown timers (live ticking)
 * - Priority color bands (Critical/High/Medium/Low)
 * - Escalation level badges
 * - Breach risk indicator
 * - Upvote support
 */

// Priority band config matching backend — using dynamic CSS variables for mode compatibility
const PRIORITY_BANDS = [
  { min: 80, label: "CRITICAL", color: "var(--red)", bg: "var(--red)", pulse: true },
  { min: 55, label: "HIGH", color: "var(--orange, #f97316)", bg: "var(--orange, #f97316)", pulse: false },
  { min: 30, label: "MEDIUM", color: "var(--yellow)", bg: "var(--yellow)", pulse: false },
  { min: 0, label: "LOW", color: "var(--green)", bg: "var(--green)", pulse: false },
];

const CATEGORY_ICONS = {
  Roads: "🛣️", Water: "💧", Electricity: "⚡",
  Sanitation: "🗑️", Safety: "🚨", Environment: "🌿", Other: "📌"
};

const ESCALATION_LABELS = {
  0: null,
  1: "Dept Head",
  2: "City Commissioner",
  3: "Govt Oversight"
};

function getPriorityBand(score) {
  for (const b of PRIORITY_BANDS) {
    if (score >= b.min) return b;
  }
  return PRIORITY_BANDS[PRIORITY_BANDS.length - 1];
}

function formatSlaCountdown(secondsRemaining) {
  if (secondsRemaining == null) return null;
  if (secondsRemaining <= 0) return { text: "SLA BREACHED", urgent: true, expired: true };
  const h = Math.floor(secondsRemaining / 3600);
  const m = Math.floor((secondsRemaining % 3600) / 60);
  const s = Math.floor(secondsRemaining % 60);
  const urgent = secondsRemaining < (secondsRemaining / 1) * 0.25 || secondsRemaining < 3600;
  if (h > 48) {
    const d = Math.floor(h / 24);
    return { text: `${d}d ${h % 24}h remaining`, urgent: false, expired: false };
  }
  return {
    text: h > 0 ? `${h}h ${m}m remaining` : `${m}m ${s}s remaining`,
    urgent: h < 2,
    expired: false
  };
}

function renderBreachRisk(risk) {
  if (!risk || risk < 0.3) return "";
  const pct = Math.round(risk * 100);
  const color = risk > 0.7 ? "#dc2626" : risk > 0.5 ? "#ea580c" : "#ca8a04";
  return `<div class="breach-risk-badge" style="color:${color};background:${color}15;padding:4px 10px;border-radius:20px;font-size:0.75rem;font-weight:700;display:inline-flex;align-items:center;gap:5px;margin-top:6px;">
    ⚠️ ${pct}% SLA Breach Risk
  </div>`;
}

function renderEscalationBadge(level) {
  if (!level || level === 0) return "";
  const label = ESCALATION_LABELS[level] || `Level ${level}`;
  return `<span style="background:#dc2626;color:white;padding:2px 8px;border-radius:20px;font-size:0.7rem;font-weight:700;animation:pulse 1s infinite;">🚨 ESC L${level}: ${label}</span>`;
}

function renderSlaBar(secondsRemaining, slaTotalHours) {
  if (secondsRemaining == null || !slaTotalHours) return "";
  const totalSec = slaTotalHours * 3600;
  const pct = Math.max(0, Math.min(100, (secondsRemaining / totalSec) * 100));
  const color = pct < 25 ? "#dc2626" : pct < 50 ? "#ea580c" : "#22c55e";
  return `
    <div style="margin-top:8px;">
      <div style="height:4px;background:#e5e7eb;border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:2px;transition:width 1s linear;"></div>
      </div>
    </div>`;
}

/**
 * Main issue card renderer.
 * @param {Object} issue - Issue object from API
 * @param {Object} opts - { showUpdateBtn, showUpvote }
 */
function renderIssueCard(issue, opts = {}) {
  const band = getPriorityBand(issue.priority_score || 0);
  const icon = CATEGORY_ICONS[issue.category] || "📌";
  const slaInfo = formatSlaCountdown(issue.sla_seconds_remaining);
  const slaCountdownId = `sla-${issue.id}`;

  const statusLabels = {
    reported: "Reported", verified: "Verified", clustered: "Clustered",
    assigned: "Assigned", in_progress: "In Progress", escalated: "🚨 Escalated", resolved: "✅ Resolved"
  };

  const breachRisk = renderBreachRisk(issue.breach_risk);
  const escalationBadge = renderEscalationBadge(issue.escalation_level);
  const slaBar = renderSlaBar(issue.sla_seconds_remaining, issue.sla_hours);

  const slaHtml = slaInfo ? `
    <div id="${slaCountdownId}" class="sla-countdown ${slaInfo.expired ? 'sla-expired' : slaInfo.urgent ? 'sla-urgent' : ''}"
         style="display:flex;align-items:center;gap:5px;font-size:0.75rem;font-weight:700;
                color:${slaInfo.expired ? '#dc2626' : slaInfo.urgent ? '#ea580c' : '#16a34a'};
                ${slaInfo.expired ? 'animation:pulse 0.8s infinite;' : ''}">
      ⏱️ ${slaInfo.text}
    </div>` : "";

  return `
<div class="issue-card hover-glow" style="border-left:4px solid ${band.color}; background: var(--glass);"
     data-issue-id="${issue.id}"
     onclick="window.location.href='issue.html?id=${issue.id}'">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
    <div style="flex:1;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center;">
        <span class="cat-badge cat-${issue.category}" style="font-size:0.78rem;">${icon} ${issue.category}</span>
        <span class="badge badge-${issue.status}" style="font-size:0.75rem;">${statusLabels[issue.status] || issue.status}</span>
        ${escalationBadge}
      </div>
      <div style="font-weight:700;font-size:0.95rem;color:var(--text-primary);line-height:1.3;">${issue.title}</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;min-width:52px;">
      <div class="priority-score priority-${band.label.toLowerCase()}"
           style="font-size:1.5rem;font-weight:900;color:${band.color};${band.pulse ? 'animation:pulse 1.2s infinite;' : ''}">
        ${issue.priority_score || 0}
      </div>
      <div style="font-size:0.65rem;font-weight:700;color:${band.color};text-transform:uppercase;">${band.label}</div>
    </div>
  </div>

  <div style="display:flex;gap:16px;font-size:0.78rem;color:var(--text-muted);flex-wrap:wrap;margin-bottom:8px;">
    <span>👥 ${(issue.impact_scale || 0).toLocaleString()}</span>
    <span>📅 ${issue.days_unresolved || 0}d open</span>
    ${issue.report_count > 1 ? `<span>📢 ${issue.report_count} reports</span>` : ""}
    ${issue.upvotes > 0 ? `<span>👍 ${issue.upvotes}</span>` : ""}
  </div>

  ${slaHtml}
  ${slaBar}
  ${breachRisk}

  ${opts.showUpdateBtn ? `<div style="margin-top:12px;" onclick="event.stopPropagation();">
    <button class="btn btn-primary btn-sm" onclick="updateIssue('${issue.id}')">Update Status</button>
  </div>` : ""}
  ${opts.showUpvote ? `<div style="margin-top:10px;" onclick="event.stopPropagation();">
    <button class="btn btn-outline btn-sm" onclick="upvoteIssue('${issue.id}',this)">👍 Upvote</button>
  </div>` : ""}
</div>`;
}

// ── SLA Live Ticker ─────────────────────────────────────────────
// Call after rendering cards to start ticking all SLA countdowns on page
const _slaTimers = {};
function startSlaCountdowns(issues) {
  // Build a map of issue id → remaining seconds (at render time)
  const remaining = {};
  issues.forEach(i => {
    if (i.sla_seconds_remaining != null && !i.sla_breached) {
      remaining[i.id] = i.sla_seconds_remaining;
    }
  });

  // Clear old timers
  Object.values(_slaTimers).forEach(t => clearInterval(t));

  issues.forEach(issue => {
    const el = document.getElementById(`sla-${issue.id}`);
    if (!el || remaining[issue.id] == null) return;

    _slaTimers[issue.id] = setInterval(() => {
      remaining[issue.id] = Math.max(0, remaining[issue.id] - 1);
      const info = formatSlaCountdown(remaining[issue.id]);
      el.textContent = "⏱️ " + info.text;
      el.style.color = info.expired ? "#dc2626" : info.urgent ? "#ea580c" : "#16a34a";
      if (info.expired) {
        el.style.animation = "pulse 0.8s infinite";
        clearInterval(_slaTimers[issue.id]);
      }

      // Update progress bar
      const bar = el.closest(".issue-card")?.querySelector(".priority-bar-fill");
      if (bar && issue.sla_hours) {
        const totalSec = issue.sla_hours * 3600;
        const pct = Math.max(0, (remaining[issue.id] / totalSec) * 100);
        bar.style.width = pct + "%";
        bar.style.background = pct < 25 ? "#dc2626" : pct < 50 ? "#ea580c" : "#22c55e";
      }
    }, 1000);
  });
}

async function updateIssue(id) {
  const user = Auth.getUser();
  if (!user || (user.role !== 'authority' && user.role !== 'admin')) {
    showToast('🚫 Only authorities can update issue status.');
    return;
  }

  const status = prompt("Update Status (verified, assigned, in_progress, escalated, resolved):");
  if (!status) return;

  const valid = ['reported', 'verified', 'clustered', 'assigned', 'in_progress', 'escalated', 'resolved'];
  if (!valid.includes(status)) {
    showToast('❌ Invalid status level.');
    return;
  }

  const note = prompt("Resolution/Update Note (Required for 'resolved'):");
  if (status === 'resolved' && !note) {
    showToast('❌ Resolution note is required.');
    return;
  }

  try {
    await API.patch(`/api/issues/${id}`, { status, resolution_note: note });
    showToast('✅ Issue updated successfully!');

    // Refresh if in dashboard or authority view
    if (typeof fetchIssues === 'function') fetchIssues();
    if (typeof loadIssues === 'function') loadIssues();

    // Refresh Global Map
    const map = MapManager.getMap();
    if (map) {
      const issues = await API.getIssues();
      MapManager.updateData(issues, user.role);
    }
  } catch (err) {
    showToast('❌ ' + err.message);
  }
}

// ── Issues Namespace ───────────────────────────────────────────
const Issues = {
  list: (params) => API.getIssues(params),
  get: (id) => API.getIssue(id),
  update: (id, data) => API.updateIssue(id, data),
  delete: (id) => API.deleteIssue(id),
  upvote: (id) => API.post(`/api/credits/upvote/${id}`, {}),
};

window.Issues = Issues;
window.getPriorityBand = getPriorityBand;
window.renderIssueCard = renderIssueCard;
window.startSlaCountdowns = startSlaCountdowns;
window.updateIssue = updateIssue;
