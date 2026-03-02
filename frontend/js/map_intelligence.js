/**
 * RESOLVIT - Map Intelligence Layer (map_intelligence.js)
 *
 * Urban Node Architecture:
 * Each marker is a UrbanNode with:
 * { geo_hash, priority_score, sla_remaining, escalation_level,
 *   density_score, pressure_score, governance_pressure_index }
 *
 * Features:
 * - Advanced hover tooltip (role-masked)
 * - Pulsing algorithm (critical / SLA < 10% / escalation >= 2)
 * - Density zone detection (Mild Cluster / Urban Stress / Crisis Zone)
 * - Governance Pressure Index ring
 * - Role-based masking (citizen / authority / admin)
 */

// ── Density scoring ─────────────────────────────────────────────
const DENSITY_RADIUS_KM = 0.5; // 500m radius for density calc

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeDensityScores(issues) {
  return issues.map(issue => {
    if (!issue.latitude || !issue.longitude) return { ...issue, density_score: 0 };
    const nearby = issues.filter(other =>
      other.id !== issue.id && other.latitude && other.longitude &&
      haversineDistance(issue.latitude, issue.longitude, other.latitude, other.longitude) <= DENSITY_RADIUS_KM
    );
    return { ...issue, density_score: nearby.length };
  });
}

function getDensityLabel(score) {
  if (score >= 30) return { label: "🔴 Civic Crisis Zone", color: "#dc2626", glow: "0 0 20px #dc262699" };
  if (score >= 15) return { label: "🟠 Urban Stress Zone", color: "#ea580c", glow: "0 0 14px #ea580c66" };
  if (score >= 5) return { label: "🟡 Mild Cluster", color: "#ca8a04", glow: "0 0 10px #ca8a0466" };
  return null;
}

// ── Pulse algorithm ─────────────────────────────────────────────
function shouldPulse(issue) {
  const score = issue.priority_score || 0;
  const slaRemainingPct = issue.sla_hours > 0
    ? (issue.sla_seconds_remaining || 0) / (issue.sla_hours * 3600)
    : 1;
  return score >= 80 || slaRemainingPct < 0.10 || (issue.escalation_level || 0) >= 2;
}

function getPulseSpeed(issue) {
  const score = issue.priority_score || 0;
  if (score >= 90) return "0.5s";
  if (score >= 80) return "0.8s";
  if ((issue.escalation_level || 0) >= 2) return "0.7s";
  return "1.2s";
}

// ── SLA status for tooltip ──────────────────────────────────────
function getSlaTooltipStatus(issue) {
  const slaRem = issue.sla_seconds_remaining;
  if (slaRem == null) return { text: "—", color: "#94a3b8", critical: false };
  if (issue.sla_breached) return { text: "🔴 AUTO-ESCALATION IN PROGRESS", color: "#dc2626", critical: true };
  const pct = issue.sla_hours ? (slaRem / (issue.sla_hours * 3600)) * 100 : 100;
  if (pct <= 20) {
    const h = Math.floor(slaRem / 3600);
    const m = Math.floor((slaRem % 3600) / 60);
    return { text: `⚠️ ${h}h ${m}m (${Math.round(pct)}% left)`, color: "#ea580c", critical: true };
  }
  const h = Math.floor(slaRem / 3600);
  const m = Math.floor((slaRem % 3600) / 60);
  return { text: `✅ ${h}h ${m}m remaining`, color: "#16a34a", critical: false };
}

// ── Governance Pressure Ring (SVG) ─────────────────────────────
function renderPressureRing(score, maxScore = 400) {
  const pct = Math.min((score || 0) / maxScore, 1);
  const radius = 20;
  const circ = 2 * Math.PI * radius;
  const dash = circ * pct;
  const color = pct >= 0.75 ? "#dc2626" : pct >= 0.5 ? "#ea580c" : pct >= 0.25 ? "#ca8a04" : "#16a34a";
  const label = pct >= 0.75 ? "PUBLIC ATTENTION RISK" : pct >= 0.5 ? "Elevated" : pct >= 0.25 ? "Moderate" : "Stable";
  return `
  <div style="display:flex;align-items:center;gap:10px;margin-top:8px;padding:8px;background:rgba(255,255,255,0.05);border-radius:10px;">
    <svg width="48" height="48" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="${radius}" fill="none" stroke="#ffffff15" stroke-width="4"/>
      <circle cx="24" cy="24" r="${radius}" fill="none" stroke="${color}" stroke-width="4"
              stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
              stroke-linecap="round" transform="rotate(-90 24 24)"/>
      <text x="24" y="28" text-anchor="middle" fill="white" font-size="9" font-weight="700">${Math.round(pct * 100)}%</text>
    </svg>
    <div>
      <div style="font-size:0.75rem;font-weight:700;color:${color};">${label}</div>
      <div style="font-size:0.7rem;color:#94a3b8;">Pressure: ${Math.round(score || 0)}</div>
    </div>
  </div>`;
}

// ── Main Urban Node Tooltip Builder ────────────────────────────
/**
 * Build advanced Leaflet popup HTML for a given issue.
 * @param {Object} issue - Issue with density_score added by computeDensityScores
 * @param {string} role - 'citizen' | 'authority' | 'admin'
 */
function buildUrbanNodePopup(issue, role = "citizen") {
  const score = issue.priority_score || 0;
  const band = typeof getPriorityBand === "function" ? getPriorityBand(score) : { color: "#6366f1", label: "—" };
  const slaStatus = getSlaTooltipStatus(issue);
  const densityInfo = getDensityLabel(issue.density_score || 0);
  const isHotspot = (issue.report_count || 1) >= 10;
  const borderColor = slaStatus.critical ? (issue.sla_breached ? "#dc2626" : "#ea580c") : "#334155";
  const escalation = issue.escalation_level || 0;
  const escalationLabel = ["—", "Dept Head", "City Commissioner", "Govt Oversight"][escalation] || `L${escalation}`;

  let html = `
  <div style="min-width:240px;max-width:280px;font-family:system-ui;font-size:0.83rem;
              background:#0f172a;color:white;border-radius:14px;overflow:hidden;
              border:2px solid ${borderColor};${slaStatus.critical ? `box-shadow:0 0 20px ${borderColor}88;` : ""}
              ${issue.sla_breached ? "animation:pulse 0.8s infinite;" : ""}">
    <!-- Header -->
    <div style="padding:12px 14px 8px;background:linear-gradient(135deg,#1e293b,#0f172a);border-bottom:1px solid #ffffff10;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">
        <span style="background:${band.color}20;color:${band.color};padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:800;">${band.label} ${score}</span>
        <span style="background:#ffffff10;padding:2px 8px;border-radius:10px;font-size:0.72rem;">${issue.category}</span>
        ${escalation > 0 ? `<span style="background:#dc262620;color:#dc2626;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:800;animation:pulse 1s infinite;">🚨 ESC L${escalation}</span>` : ""}
        ${isHotspot ? `<span style="background:#f59e0b20;color:#f59e0b;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;">🔥 Community Hotspot</span>` : ""}
        ${densityInfo ? `<span style="color:${densityInfo.color};font-size:0.72rem;font-weight:700;">${densityInfo.label}</span>` : ""}
      </div>
      <div style="font-weight:700;font-size:0.92rem;line-height:1.3;">${issue.title}</div>
    </div>
    <!-- SLA Status -->
    <div style="padding:8px 14px;background:${slaStatus.color}12;border-bottom:1px solid #ffffff08;">
      <div style="font-weight:700;color:${slaStatus.color};font-size:0.78rem;${issue.sla_breached ? 'animation:pulse 0.8s infinite;' : ''}">${slaStatus.text}</div>
    </div>
    <!-- Core Stats -->
    <div style="padding:10px 14px;display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;">
      <div><span style="color:#64748b;font-size:0.72rem;">Reports</span><br/><strong>📢 ${issue.report_count || 1}</strong></div>
      <div><span style="color:#64748b;font-size:0.72rem;">Upvotes</span><br/><strong>👍 ${issue.upvotes || 0}</strong></div>
      <div><span style="color:#64748b;font-size:0.72rem;">Status</span><br/><strong>${(issue.status || "").replace("_", " ")}</strong></div>
      <div><span style="color:#64748b;font-size:0.72rem;">SLA Total</span><br/><strong>⏱️ ${issue.sla_hours || "—"}h</strong></div>
    </div>`;

  // Authority view additions
  if (role === "authority" || role === "admin") {
    html += `
    <div style="padding:8px 14px;border-top:1px solid #ffffff08;">
      <div style="color:#94a3b8;font-size:0.72rem;margin-bottom:4px;">🏛️ Assigned</div>
      <div><strong>${issue.authority_name || "Unassigned"}</strong></div>
      ${issue.authority_department ? `<div style="color:#94a3b8;font-size:0.72rem;">${issue.authority_department}</div>` : ""}
      ${escalation > 0 ? `<div style="color:#dc2626;font-size:0.78rem;font-weight:700;margin-top:4px;">Escalated to: ${escalationLabel}</div>` : ""}
    </div>`;
  }

  // Admin view additions
  if (role === "admin") {
    html += `
    <div style="padding:8px 14px;border-top:1px solid #ffffff08;">
      ${renderPressureRing(issue.pressure_score)}
    </div>`;

    // Breach risk if available
    if (issue.breach_risk != null) {
      const riskPct = Math.round((issue.breach_risk || 0) * 100);
      const riskColor = riskPct >= 80 ? "#dc2626" : riskPct >= 60 ? "#ea580c" : riskPct >= 30 ? "#ca8a04" : "#16a34a";
      html += `
    <div style="padding:0 14px 8px;">
      <div style="font-size:0.72rem;color:#94a3b8;margin-bottom:4px;">Escalation Risk Forecast</div>
      <div style="height:6px;background:#ffffff10;border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${riskPct}%;background:${riskColor};border-radius:3px;transition:width 0.5s;"></div>
      </div>
      <div style="color:${riskColor};font-size:0.72rem;font-weight:700;margin-top:3px;">${riskPct}% Risk</div>
    </div>`;
    }
  }

  // Simulated badge
  if (issue.is_simulated) {
    html += `<div style="padding:4px 14px;background:#ffffff08;font-size:0.7rem;color:#94a3b8;font-style:italic;">🔬 Simulated Data</div>`;
  }

  html += `
    <div style="padding:10px 14px 12px;border-top:1px solid #ffffff08;">
      <a href="issue.html?id=${issue.id}" style="display:block;text-align:center;background:linear-gradient(90deg,#6366f1,#8b5cf6);color:white;padding:8px;border-radius:10px;font-size:0.82rem;font-weight:700;text-decoration:none;">View Full Detail →</a>
    </div>
  </div>`;

  return html;
}

/**
 * Render Urban Nodes on a Leaflet map.
 * @param {Object} map - Leaflet map instance
 * @param {Array}  issues - Issues array from API
 * @param {string} role - User role for masking
 * @param {Object} clusterGroup - Optional Leaflet markerClusterGroup
 */
function renderUrbanNodes(map, issues, role = "citizen", clusterGroup = null) {
  if (!map) return;

  // Clear existing non-cluster layers (circles, etc)
  map.eachLayer(layer => {
    if (layer instanceof L.Circle || (layer instanceof L.Marker && !clusterGroup)) {
      map.removeLayer(layer);
    }
  });

  if (clusterGroup) clusterGroup.clearLayers();

  const scoredIssues = computeDensityScores(issues);
  const bounds = [];

  scoredIssues.forEach(issue => {
    if (!issue.latitude || !issue.longitude) return;

    const score = issue.priority_score || 0;
    const band = typeof getPriorityBand === "function" ? getPriorityBand(score) : { color: "#6366f1", label: "?" };
    const pulse = shouldPulse(issue);
    const speed = getPulseSpeed(issue);
    const size = score >= 80 ? 22 : score >= 55 ? 18 : score >= 30 ? 14 : 11;
    const densityInfo = getDensityLabel(issue.density_score || 0);
    const glowColor = issue.sla_breached ? "#dc2626" : densityInfo?.color || band.color;

    const icon = L.divIcon({
      className: "urban-marker-container",
      html: `<div class="urban-marker" style="
        width:${size}px;height:${size}px;
        background:${band.color};
        box-shadow:0 0 12px ${glowColor}66;
        ${pulse ? `animation:mapPulse ${speed} ease-in-out infinite;` : ""}
      "></div>
      ${issue.is_simulated ? `<div class="sim-badge"></div>` : ""}
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });

    const marker = L.marker([issue.latitude, issue.longitude], { icon })
      .bindPopup(buildUrbanNodePopup(issue, role), {
        maxWidth: 300,
        className: "urban-node-popup",
      });

    if (clusterGroup) {
      clusterGroup.addLayer(marker);
    } else {
      marker.addTo(map);
    }

    if (marker._icon) {
      marker._icon.style.animation = "markerDrop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards";
    }

    bounds.push([issue.latitude, issue.longitude]);
  });

  // Fit map to markers
  if (bounds.length > 0) {
    try { map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 }); } catch (e) { }
  }

  // Inject refined map styles
  injectMapStyles();

  return scoredIssues;
}

function injectMapStyles() {
  if (document.getElementById("map-intelligence-styles")) return;
  const s = document.createElement("style");
  s.id = "map-intelligence-styles";
  s.textContent = `
    @keyframes mapPulse {
      0%   { transform: scale(1);   opacity: 1; box-shadow: 0 0 0px var(--accent-glow); }
      50%  { transform: scale(1.4); opacity: 0.7; box-shadow: 0 0 20px var(--accent-glow); }
      100% { transform: scale(1);   opacity: 1; box-shadow: 0 0 0px var(--accent-glow); }
    }
    @keyframes markerDrop {
      from { transform: translateY(-50px) scale(0); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
    .urban-marker {
      border-radius: 50%;
      border: 2px solid white;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .urban-marker:hover {
      transform: scale(1.2);
      filter: brightness(1.2);
    }
    .sim-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #8b5cf6;
      border: 1px solid white;
    }
    .urban-node-popup .leaflet-popup-content-wrapper {
      background: #0f172a !important;
      color: white !important;
      border-radius: 14px !important;
      padding: 0 !important;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5) !important;
    }
    .urban-node-popup .leaflet-popup-content {
      margin: 0 !important;
      width: 280px !important;
    }
    .urban-node-popup .leaflet-popup-tip {
      background: #0f172a !important;
    }
    /* Force Map Clarity - No filters from theme */
    .leaflet-container {
      filter: none !important;
      background: #f8fafc !important;
    }
  `;
  document.head.appendChild(s);
}

// ── Density Overlay Zones (cluster rings) ──────────────────────
function renderDensityOverlays(map, issues) {
  if (!map) return;

  const scoredIssues = computeDensityScores(issues);

  // Draw circles for high-density zones only
  const highDensity = scoredIssues.filter(i => i.density_score >= 15 && i.latitude && i.longitude);
  const drawn = new Set();

  highDensity.forEach(issue => {
    const key = `${issue.latitude.toFixed(3)}_${issue.longitude.toFixed(3)}`;
    if (drawn.has(key)) return;
    drawn.add(key);

    const info = getDensityLabel(issue.density_score);
    if (!info) return;

    L.circle([issue.latitude, issue.longitude], {
      radius: issue.density_score >= 30 ? 500 : 300,
      color: info.color,
      fillColor: info.color,
      fillOpacity: 0.08,
      weight: 1.5,
      dashArray: "6,4",
    })
      .addTo(map)
      .bindTooltip(info.label, { permanent: false, className: "density-tooltip" });
  });
}
