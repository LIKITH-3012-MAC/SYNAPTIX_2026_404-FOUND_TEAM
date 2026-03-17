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

// ── Predictive Priority Logic ──────────────────────────────────
/**
 * ResolvIt Advanced Priority Formula:
 * (Reports * 2) + Severity(1-4) + Days Unresolved + Community Upvotes
 */
function computePredictiveScore(issue) {
  const reports = issue.report_count || 1;
  const severity = issue.severity_level || (issue.priority_score >= 80 ? 4 : issue.priority_score >= 60 ? 3 : 2);
  const days = issue.days_unresolved || 0;
  const upvotes = issue.upvotes || 0;

  return (reports * 2) + severity + days + upvotes;
}

function getPriorityBand(score) {
  if (score >= 80) return { label: "CRITICAL", color: "#dc2626", glow: "var(--red-glow)" };
  if (score >= 55) return { label: "HIGH", color: "#ea580c", glow: "var(--orange-glow)" };
  if (score >= 30) return { label: "MEDIUM", color: "#ca8a04", glow: "var(--yellow-glow)" };
  return { label: "LOW", color: "#16a34a", glow: "var(--green-glow)" };
}

// ── SLA & Predictive Escalation ────────────────────────────────
function getEscalationLikelihood(issue) {
  const score = computePredictiveScore(issue);
  if (score > 150) return 95;
  if (score > 80) return 75;
  if (score > 40) return 40;
  return 15;
}

// ── Main Urban Node Tooltip Builder (Insane v2) ────────────────
function buildUrbanNodePopup(issue, role = "citizen") {
  const score = computePredictiveScore(issue);
  const band = getPriorityBand(score);
  const likelihood = getEscalationLikelihood(issue);
  const slaStatus = getSlaTooltipStatus(issue);
  const escalation = issue.escalation_level || 0;
  const escalationLabel = ["—", "Dept Head", "City Commissioner", "Govt Oversight"][escalation] || `L${escalation}`;

  let html = `
  <div class="urban-node-premium-card" style="border-top: 4px solid ${band.color};">
    <div class="popup-header">
      <div class="flex justify-between items-center">
        <span class="badge" style="background:${band.color}20; color:${band.color};">${band.label} ${score}</span>
        <span class="text-muted" style="font-size:0.7rem;">#${issue.id.slice(-6)}</span>
      </div>
      <h4 style="margin:8px 0; color:white; font-size:1rem;">${issue.title}</h4>
      <div style="font-size:0.7rem; color:var(--text-secondary);">${issue.category}</div>
      ${issue.image_url ? `<div style="margin-top:10px; border-radius:8px; overflow:hidden; border:1px solid var(--border);"><img src="${issue.image_url}" style="width:100%; height:120px; object-fit:cover; display:block;" /></div>` : ''}
    </div>
    
    <div class="popup-sla-box" style="background:${slaStatus.color}10; padding:12px; border-left:4px solid ${slaStatus.color};">
      <div class="flex items-center gap-4">
        <div class="sla-ring-container" style="position:relative; width:32px; height:32px;">
          <svg width="32" height="32" style="transform:rotate(-90deg);">
             <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="3"/>
             <circle cx="16" cy="16" r="14" fill="none" stroke="${slaStatus.color}" stroke-width="3" 
                    stroke-dasharray="88" stroke-dashoffset="${88 - (likelihood / 100) * 88}" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <div style="color:${slaStatus.color}; font-weight:800; font-size:0.75rem;">${slaStatus.text}</div>
          <div class="text-muted" style="font-size:0.65rem;">Predictive Escalation: ${likelihood}%</div>
        </div>
      </div>
    </div>

    <div class="popup-stats" style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding:12px 16px;">
      <div style="text-align:center;"><div style="font-size:0.8rem;">📢</div><strong style="font-size:0.85rem;">${issue.report_count || 1}</strong></div>
      <div style="text-align:center;"><div style="font-size:0.8rem;">👍</div><strong style="font-size:0.85rem;">${issue.upvotes || 0}</strong></div>
      <div style="text-align:center;"><div style="font-size:0.8rem;">⏱️</div><strong style="font-size:0.85rem;">${issue.days_unresolved || 0}d</strong></div>
    </div>
  `;

  if (role === "admin" || role === "authority") {
    html += `
    <div class="ai-insights" style="margin:8px 16px 16px; padding-top:10px; border-top:1px solid var(--border);">
      <div style="font-size:0.7rem; color:var(--accent); font-weight:700; margin-bottom:4px;">🤖 AI RECOMMENDATION</div>
      <p style="font-size:0.75rem; color:var(--text-secondary); line-height:1.4;">High proximity to existing clusters. Recommended action: <strong>Status Audit</strong>.</p>
    </div>`;
  }

  if (issue.is_simulated) {
    html += `<div style="padding:4px 16px; background:rgba(139, 92, 246, 0.1); font-size:0.7rem; color:#a855f7; font-style:italic;">🔬 Simulated Intelligence Data</div>`;
  }

  html += `
    <div style="padding:0 16px 16px;">
      <a href="issue.html?id=${issue.id}" class="btn-cyber" style="width:100%; font-size:0.8rem; justify-content:center; text-decoration:none; padding:10px; border-radius:10px; background:var(--accent); color:white; display:flex;">Enter Resolution Hub</a>
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
      className: "premium-marker-wrapper",
      html: `
        <div class="urban-marker-premium" style="width:${size}px; height:${size}px;">
            <div class="marker-inner-core" style="background:${band.color}; box-shadow:0 0 15px ${glowColor}aa;"></div>
            ${pulse ? `<div class="marker-pulse-ring" style="border-color:${band.color}; animation-duration:${speed};"></div>` : ""}
            ${(issue.escalation_level && issue.escalation_level >= 1) ? `<div class="marker-esc-badge">!</div>` : ""}
            ${issue.is_simulated ? `<div class="marker-sim-badge">AI</div>` : ""}
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });

    const marker = L.marker([issue.latitude, issue.longitude], { 
        icon, 
        priorityScore: score,
        id: issue.id,
        issueData: issue 
    }).bindPopup(buildUrbanNodePopup(issue, role), {
        maxWidth: 320,
        className: "leaflet-popup-premium",
        closeButton: false
    });

    // Add Hover Interactions (Desktop only to prevent mobile jitter)
    if (!('ontouchstart' in window)) {
        marker.on("mouseover", function (e) { this.openPopup(); });
    }
    // Keep open on hover by preventing immediate close unless they leave marker bounds without entering popup bounds
    // Alternatively, just do click for open and hover for preview. By requested interactions:
    // marker.on("mouseout", function(e) { this.closePopup(); }); 

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
    .urban-node-premium-card {
        padding: 0;
        border-radius: 18px;
        overflow: hidden;
    }
    .urban-node-premium-card .popup-header {
        padding: 20px;
    }
    .urban-node-premium-card .badge {
        padding: 4px 12px;
        border-radius: 999px;
        font-weight: 800;
        font-size: 0.75rem;
        text-transform: uppercase;
    }
    .premium-marker-wrapper {
        background: transparent !important;
        border: none !important;
    }
    .marker-pulse-ring {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        border: 2px solid;
        border-radius: 50%;
        opacity: 0;
        animation: premiumMarkerPulse 1.5s ease-out infinite;
    }
    @keyframes premiumMarkerPulse {
        0% { transform: scale(1); opacity: 0.8; }
        100% { transform: scale(2.5); opacity: 0; }
    }
    .marker-esc-badge {
        position: absolute;
        top: -8px;
        right: -8px;
        background: #ef4444;
        color: white;
        font-size: 10px;
        font-weight: 900;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .marker-sim-badge {
        position: absolute;
        bottom: -8px;
        left: 50%;
        transform: translateX(-50%);
        background: #8b5cf6;
        color: white;
        font-size: 8px;
        font-weight: 900;
        padding: 2px 6px;
        border-radius: 6px;
        border: 1px solid white;
    }
    @keyframes markerDrop {
        from { transform: translateY(-30px) scale(0); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
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

// ── Cluster Intelligence Panel (Slide-in) ────────────────────────
/**
 * Open the Elite Cluster Intelligence Panel.
 * @param {Array} markers - Leaflet markers inside the cluster
 */
function openClusterIntel(markers) {
  const issues = markers.map(m => {
    // Find full issue from ID if possible, or build from marker options
    return typeof _allIssues !== 'undefined' ?
      _allIssues.find(i => i.id === m.options.id) || m.options.issueData :
      m.options.issueData;
  }).filter(Boolean);

  if (!issues.length) return;

  // Aggregate stats
  const totalReports = issues.reduce((acc, i) => acc + (i.report_count || 1), 0);
  const avgSeverity = issues.length ? (issues.reduce((acc, i) => acc + (i.severity_level || 2), 0) / issues.length).toFixed(1) : 2;
  const maxScore = Math.max(...issues.map(i => i.priority_score || 0));
  const band = getPriorityBand(maxScore);

  // Build Panel HTML
  let panel = document.getElementById('cluster-intel-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'cluster-intel-panel';
    panel.className = 'glass intel-panel';
    document.body.appendChild(panel);
  }

  panel.innerHTML = `
        <div class="flex justify-between items-center" style="margin-bottom:32px;">
            <div>
               <div style="font-size:0.75rem; color:var(--accent); font-weight:800; letter-spacing:1px; margin-bottom:4px;">ELITE URBAN INTELLIGENCE</div>
               <h2 style="font-size:1.5rem;">Cluster Node #${issues[0].id.slice(0, 5)}</h2>
            </div>
            <button onclick="closeClusterIntel()" class="btn-sm btn-ghost" style="font-size:1.2rem;">✕</button>
        </div>

        <div id="cluster-mini-map" style="width:100%; height:180px; border-radius:18px; margin-bottom:24px; border:1px solid var(--border); overflow:hidden;"></div>

        <div class="card" style="border:1px solid ${band.color}; border-radius:14px; background:${band.color}05; padding:20px; margin-bottom:32px;">
            <div class="flex justify-between items-center">
                <div>
                   <div style="font-size:2.5rem; font-weight:900; color:${band.color}; line-height:1;">${maxScore}</div>
                   <div style="font-size:0.7rem; font-weight:800; color:var(--text-muted); margin-top:4px;">CLUSTER MAX PRIORITY</div>
                </div>
                <div style="text-align:right;">
                   <div class="badge" style="background:${band.color}; color:white; padding:4px 12px; border-radius:99px; font-weight:800;">${band.label}</div>
                   <div style="font-size:0.75rem; margin-top:8px; color:var(--text-secondary);">${issues.length} Connected Issues</div>
                </div>
            </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:32px;">
            <div class="glass card" style="padding:16px; text-align:center; border-radius:14px;">
                <div style="font-size:1.2rem; font-weight:800; color:white;">${totalReports}</div>
                <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">COMMUNITY SIGNALS</div>
            </div>
            <div class="glass card" style="padding:16px; text-align:center; border-radius:14px;">
                <div style="font-size:1.2rem; font-weight:800; color:${avgSeverity > 3 ? 'var(--red)' : 'var(--accent)'}">${avgSeverity}/4</div>
                <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">AVG SEVERITY</div>
            </div>
        </div>

        <h4 style="margin-bottom:16px; text-transform:uppercase; font-size:0.8rem; letter-spacing:1px; color:var(--text-secondary); font-weight:800;">AI Resolution Pathway</h4>
        <div class="flex flex-col gap-4" style="margin-bottom:32px;">
            ${issues.slice(0, 5).map(issue => `
                <div class="glass card-hover" style="padding:16px; border-radius:12px; cursor:pointer;" onclick="location.href='issue.html?id=${issue.id}'">
                    <div class="flex justify-between items-center">
                        <strong style="font-size:0.85rem; color:white;">${issue.title}</strong>
                        <span style="font-size:0.75rem; color:${getPriorityBand(issue.priority_score).color}; font-weight:900;">${issue.priority_score}</span>
                    </div>
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:6px;">${issue.category} · ${issue.status.replace(/_/g, ' ')}</div>
                </div>
            `).join('')}
            ${issues.length > 5 ? `<div style="text-align:center; font-size:0.75rem; color:var(--accent); font-weight:700;">+${issues.length - 5} more issues in this node</div>` : ''}
        </div>

        <div class="ai-recommendation glass" style="border:1.5px dashed var(--accent); padding:24px; border-radius:18px; position:relative; background:var(--accent)05;">
            <div style="position:absolute; top:-12px; left:24px; background:var(--bg-primary); padding:0 12px; font-size:0.7rem; color:var(--accent); font-weight:900; letter-spacing:1px;">AI PREDICTIVE INSIGHT</div>
            <p style="font-size:0.85rem; line-height:1.7; color:var(--text-secondary);">
                Cluster anomaly detected. Critical density exceeded at current coordinates. <strong>SLA breach likelihood is 92%</strong> within 6h. 
                Recommended action: <strong>Immediate Escalation</strong>.
            </p>
            ${typeof Auth !== 'undefined' && (Auth.hasRole('authority', 'admin')) ? `
            <button class="btn-cyber" style="width:100%; margin-top:24px; justify-content:center; box-shadow: 0 0 20px var(--accent-glow);" onclick="initiateClusterAction('${issues[0].cluster_id}')">Initiate Strategic Intervention</button>
            <div class="flex gap-2" style="margin-top:12px;">
                <button class="btn btn-outline btn-sm" style="flex:1;" onclick="splitCluster('${issues[0].cluster_id}')">✂️ Split</button>
                <button class="btn btn-outline btn-sm" style="flex:1;" onclick="mergeManual('${issues[0].cluster_id}')">🔗 Merge</button>
            </div>
            ` : `
            <div style="margin-top:20px; padding:12px; background:rgba(255,255,255,0.05); border-radius:8px; font-size:0.75rem; color:var(--text-muted); text-align:center;">
                🔒 Strategic actions restricted to Authority Personnel
            </div>
            `}
        </div>
    `;

  panel.classList.add('open');

  // Initialize Mini Map
  setTimeout(() => {
    const miniMap = L.map('cluster-mini-map', {
      zoomControl: false,
      attributionControl: false
    }).setView([issues[0].latitude, issues[0].longitude], 16);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(miniMap);

    issues.forEach(i => {
      L.circleMarker([i.latitude, i.longitude], {
        radius: 6,
        color: getPriorityBand(i.priority_score).color,
        fillOpacity: 1
      }).addTo(miniMap);
    });

    // Confetti for High Priority
    if (maxScore >= 80 && typeof Gamification !== 'undefined') {
      Gamification.launchEmojiConfetti('🚨');
    }
  }, 600);
}

function closeClusterIntel() {
  const panel = document.getElementById('cluster-intel-panel');
  if (panel) panel.classList.remove('open');
}

window.openClusterIntel = openClusterIntel;
window.closeClusterIntel = closeClusterIntel;
