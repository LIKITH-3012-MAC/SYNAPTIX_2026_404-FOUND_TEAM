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
  const score = issue.priority_score || 0;
  const band = getPriorityBand(score);
  const icon = CATEGORY_ICONS[issue.category] || "📌";
  const likelihood = issue.breach_risk ? Math.round(issue.breach_risk * 100) : 15;
  const slaInfo = formatSlaCountdown(issue.sla_seconds_remaining);
  const slaCountdownId = `sla-${issue.id}`;

  // Detect demo / simulation issues — they have no DB record, so clicking
  // issue.html?id=... would 404 → perpetual loading state.
  const isDemo = !!(issue.is_simulated || issue.is_demo);

  const statusLabels = {
    reported: "REPOR", verified: "VERIF", clustered: "CLUS",
    assigned: "ASSIG", in_progress: "PROGR", escalated: "ESCAL", resolved: "RESOL"
  };

  const badgeClass = `badge-${issue.status || 'reported'}`;
  const isCritical = score >= 80;

  const clickAction = `event.stopPropagation(); if(typeof DetailManager !== 'undefined') DetailManager.open('${issue.id}'); else window.location.href='issue.html?id=${issue.id}';`;

  return `
    <div class="glass-card-premium issue-card-v2 gpu-accelerate ${isCritical ? 'pulse-critical' : ''}" 
         style="border-left: 5px solid ${band.color}; cursor:${isDemo ? 'default' : 'pointer'}; content-visibility: auto; contain-intrinsic-size: 0 160px; position:relative;" 
         onclick="${clickAction}">
      
      ${isDemo ? `<div style="position:absolute;top:10px;right:10px;font-size:0.62rem;background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 8px;border-radius:20px;font-weight:700;border:1px solid rgba(99,102,241,0.3);pointer-events:none;">🧠 DEMO</div>` : ''}

      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="font-size:1.5rem; background:rgba(255,255,255,0.05); padding:8px; border-radius:12px;">${icon}</div>
          <div>
            <div style="color:${band.color}; font-size:1.4rem; font-weight:900; line-height:1;">${score}</div>
            <div style="font-size:0.6rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:800; margin-top:2px;">PRIORITY</div>
          </div>
        </div>
        <div class="badge ${badgeClass}" style="font-size:0.6rem; letter-spacing:1px; border:1px solid currentColor; background:transparent; padding:4px 10px; margin-right:${isDemo ? '62px' : '0'};">
          ${(statusLabels[issue.status] || issue.status || 'REPOR').toUpperCase()}
        </div>
      </div>

      <h3 style="margin-bottom:12px; font-size:1.05rem; line-height:1.4; color:white; font-weight:700;">${issue.title}</h3>
      
      <div class="sla-preview-row glass" style="background:rgba(255,255,255,0.02); padding:12px; border-radius:12px; border:1px solid var(--border); margin-top:auto;">
         <div style="display:flex; align-items:center; gap:12px;">
            <div style="position:relative; width:28px; height:28px;">
               <svg width="28" height="28" style="transform:rotate(-90deg);">
                  <circle cx="14" cy="14" r="12" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="2"/>
                  <circle cx="14" cy="14" r="12" fill="none" stroke="${slaInfo?.urgent ? 'var(--red)' : 'var(--accent)'}" 
                          stroke-width="2" stroke-dasharray="75" stroke-dashoffset="${75 - (likelihood / 100) * 75}" stroke-linecap="round"/>
               </svg>
            </div>
            <div id="${slaCountdownId}" style="font-size:0.75rem; font-weight:700; color:${slaInfo?.urgent ? 'var(--red)' : 'var(--text-secondary)'};">
               ${slaInfo?.text || 'SLA PENDING'}
            </div>
         </div>
         <div style="font-size:0.6rem; color:var(--text-muted); margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:6px;">
               <div style="width:6px; height:6px; background:${likelihood > 50 ? 'var(--red)' : 'var(--green)'}; border-radius:50%;"></div>
               <span>AI RISK: ${likelihood}%</span>
            </div>
            <span>📢 ${issue.report_count || 1} REPORTS</span>
         </div>
      </div>

      <div style="margin-top:16px; display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:12px;">
          <div style="display:flex; align-items:center; gap:10px;">
             ${opts.showUpvote && !isDemo ? `<button class="btn btn-sm btn-ghost" style="padding:4px 8px;" onclick="event.stopPropagation(); upvoteIssue('${issue.id}', this)">👍 ${issue.upvotes || 0}</button>` : ''}
             ${!isDemo ? `<button class="btn btn-sm btn-ghost" style="padding:4px 8px;" onclick="event.stopPropagation(); exportSingleIssue('${issue.id}')" title="Download Official Record">📁</button>` : ''}
          </div>
          <span style="font-size:0.65rem; color:var(--text-muted); font-weight:600;">#${(issue.id || '').slice(-6)}</span>
      </div>
    </div>
  `;
}

/**
 * Trigger single issue PDF export (Certificate of Submission)
 */
async function exportSingleIssue(id) {
    if (typeof showToast === 'function') showToast(`⏳ Generating submission certificate...`, 'info');
    const token = localStorage.getItem('resolvit_token');
    try {
        const response = await fetch(`${API.BASE_URL}/api/export/issue/${id}/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Generation failed');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `resolvit_report_${id.slice(0,8)}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        if (typeof showToast === 'function') showToast(`✅ Certificate Generated!`, 'success');
    } catch (e) {
        if (typeof showToast === 'function') showToast(`❌ Export failed: ${e.message}`, 'error');
    }
}
window.exportSingleIssue = exportSingleIssue;

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

        // System alert for breach
        if (!issue.sla_breached) {
          issue.sla_breached = true;
          if (typeof showToast === 'function') {
            showToast(`🚨 SYSTEM ALERT: SLA Breached for Issue #${issue.id.slice(-6)}! Penalty flag assigned.`, 'error');
          }
        }
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
