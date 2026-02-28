/**
 * RESOLVIT - AI Demo/Simulation Engine (simulation.js)
 *
 * Features:
 * - Floating Demo Control Panel (admin only)
 * - Generate 100/300/500 synthetic issues
 * - Crisis mode (heavy hotspot clusters + SLA breaches)
 * - Auto-heatmap activation + lock during demo
 * - Live counters updating every 3s
 * - Auto-cleanup
 */

let _demoActive = false;
let _demoCounterInterval = null;
let _demoLiveInterval = null;
let _demoIssueCount = 0;

// ── Demo Control Panel ──────────────────────────────────────────
function initDemoPanel() {
    const user = typeof Auth !== "undefined" ? Auth.getUser() : null;
    if (!user || user.role !== "admin") return;

    // Inject floating panel
    const panel = document.createElement("div");
    panel.id = "demo-control-panel";
    panel.innerHTML = `
    <div id="demo-panel-inner" style="
      position:fixed;bottom:24px;right:24px;z-index:9999;
      background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);
      border:1px solid #6366f1;border-radius:20px;padding:20px 24px;
      box-shadow:0 0 40px rgba(99,102,241,0.3);min-width:260px;
      font-family:system-ui;color:white;
      transition:all 0.3s ease;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-size:0.95rem;font-weight:800;">🧠 AI Demo Mode</div>
        <button onclick="toggleDemoPanel()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;">─</button>
      </div>
      <div id="demo-status-badge" style="
        background:rgba(99,102,241,0.2);border:1px solid #6366f1;
        border-radius:10px;padding:6px 12px;font-size:0.78rem;
        text-align:center;margin-bottom:16px;color:#a5b4fc;">
        🔴 Simulation Inactive
      </div>
      <div style="display:grid;gap:8px;">
        <button onclick="runSimulation(100,false)" class="demo-btn" id="btn-100">⚡ Generate 100 Issues</button>
        <button onclick="runSimulation(300,false)" class="demo-btn" id="btn-300">🌆 Generate 300 Issues</button>
        <button onclick="runSimulation(300,true)" class="demo-btn demo-btn-crisis" id="btn-crisis">🆘 CIVIC CRISIS MODE</button>
        <hr style="border-color:#ffffff15;margin:4px 0;"/>
        <button onclick="clearSimulation()" class="demo-btn demo-btn-clear" id="btn-clear">🧹 Clear Simulation</button>
      </div>
      <div id="demo-live-stats" style="display:none;margin-top:14px;padding:12px;background:rgba(255,255,255,0.05);border-radius:12px;font-size:0.8rem;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><div id="demo-total" style="font-size:1.4rem;font-weight:900;color:#6366f1;">0</div><div style="color:#94a3b8;">Issues</div></div>
          <div><div id="demo-escalated" style="font-size:1.4rem;font-weight:900;color:#dc2626;">0</div><div style="color:#94a3b8;">Escalated</div></div>
          <div><div id="demo-breached" style="font-size:1.4rem;font-weight:900;color:#ea580c;">0</div><div style="color:#94a3b8;">SLA Breach</div></div>
          <div><div id="demo-pressure" style="font-size:1.4rem;font-weight:900;color:#ca8a04;">↑</div><div style="color:#94a3b8;">Pressure</div></div>
        </div>
      </div>
      <div id="demo-ticker" style="display:none;margin-top:10px;font-size:0.72rem;color:#6366f1;font-weight:700;animation:pulse 1s infinite;">
        📡 Simulation Active — Live data flowing...
      </div>
    </div>
  `;
    document.body.appendChild(panel);

    // Inject styles
    const style = document.createElement("style");
    style.textContent = `
    .demo-btn { width:100%;padding:10px 14px;border:1px solid rgba(99,102,241,0.4);border-radius:10px;background:rgba(99,102,241,0.15);color:white;font-size:0.82rem;font-weight:600;cursor:pointer;transition:all 0.2s; text-align:left;}
    .demo-btn:hover { background:rgba(99,102,241,0.35);border-color:#6366f1; transform: translateX(2px); }
    .demo-btn-crisis { background:rgba(220,38,38,0.15);border-color:rgba(220,38,38,0.4); }
    .demo-btn-crisis:hover { background:rgba(220,38,38,0.35);border-color:#dc2626; }
    .demo-btn-clear { background:rgba(100,116,139,0.1);border-color:rgba(100,116,139,0.3); }
    .demo-btn-clear:hover { background:rgba(100,116,139,0.25); }
    .demo-btn:disabled { opacity:0.4;cursor:not-allowed;transform:none; }
    #demo-sim-badge { position:fixed;top:16px;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#6366f1,#ec4899);color:white;padding:8px 20px;border-radius:30px;font-size:0.82rem;font-weight:700;z-index:10000;box-shadow:0 4px 20px rgba(99,102,241,0.5);animation:fadeIn 0.5s ease; }
    @keyframes fadeIn { from{opacity:0;transform:translateX(-50%) translateY(-10px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    .issue-count-ticker { position:fixed;top:60px;left:50%;transform:translateX(-50%);background:#0f172a;color:#6366f1;border:1px solid #6366f1;padding:4px 16px;border-radius:20px;font-size:0.75rem;font-weight:700;z-index:9999;font-variant-numeric:tabular-nums; }
  `;
    document.head.appendChild(style);

    // Check initial status
    checkDemoStatus();
}

function toggleDemoPanel() {
    const inner = document.getElementById("demo-panel-inner");
    if (inner) inner.style.display = inner.style.display === "none" ? "" : "none";
}

async function runSimulation(count, crisisMode) {
    const buttons = document.querySelectorAll(".demo-btn");
    buttons.forEach(b => b.disabled = true);
    updateDemoStatus("⏳ Generating issues...", "#ca8a04");

    try {
        const res = await API.post("/api/simulation/generate", { count, crisis_mode: crisisMode });
        _demoActive = true;
        _demoIssueCount = res.generated;

        updateDemoStatus(`✅ Simulation ACTIVE — ${res.generated} issues`, "#6366f1");
        showDemoBadge(crisisMode ? "🆘 CIVIC CRISIS MODE ACTIVE" : `🧠 AI Demo Running — ${res.generated} Issues`);
        showDemoLiveStats(res.generated, res.escalated, res.sla_breached);

        // Show toast
        if (typeof showToast !== "undefined") {
            showToast(`🚀 Demo active: ${res.generated} issues | ${res.escalated} escalated | ${res.sla_breached} SLA breached`, "success");
        }

        // Lock heatmap ON if available
        if (typeof toggleMap === "function" && !window._mapVisible) {
            toggleMap();
        }

        // Start live update ticker
        startDemoLiveTicker();

        // Reload map if available
        if (typeof fetchIssues === "function") fetchIssues();
        if (typeof loadDashboard === "function") loadDashboard();

    } catch (e) {
        updateDemoStatus("❌ Error: " + (e.message || "Failed"), "#dc2626");
        if (typeof showToast !== "undefined") showToast("Simulation failed: " + e.message, "error");
    } finally {
        buttons.forEach(b => b.disabled = false);
    }
}

async function clearSimulation() {
    if (!confirm("Clear all simulated data? This will restore real data only.")) return;

    try {
        const res = await API.post("/api/simulation/clear", {});
        _demoActive = false;
        stopDemoLiveTicker();
        removeDemoBadge();
        updateDemoStatus("🔴 Simulation Inactive", "#94a3b8");
        hideDemoLiveStats();

        if (typeof showToast !== "undefined") showToast(res.message, "success");
        if (typeof fetchIssues === "function") fetchIssues();
        if (typeof loadDashboard === "function") loadDashboard();
    } catch (e) {
        if (typeof showToast !== "undefined") showToast("Clear failed: " + e.message, "error");
    }
}

async function checkDemoStatus() {
    try {
        const status = await API.get("/api/simulation/status");
        if (status.active) {
            _demoActive = true;
            _demoIssueCount = status.simulated_count;
            updateDemoStatus(`✅ Simulation ACTIVE — ${status.simulated_count} issues`, "#6366f1");
            showDemoBadge(`🧠 Demo Mode — ${status.simulated_count} Synthetic Issues`);
            showDemoLiveStats(status.simulated_count, status.simulated_escalated, status.simulated_breached);
            startDemoLiveTicker();
        }
    } catch (e) { }
}

function startDemoLiveTicker() {
    stopDemoLiveTicker();
    const ticker = document.getElementById("demo-ticker");
    if (ticker) ticker.style.display = "block";

    _demoLiveInterval = setInterval(async () => {
        try {
            const status = await API.get("/api/simulation/status");
            updateLiveStatCounters(status.simulated_count, status.simulated_escalated, status.simulated_breached);
        } catch (e) { }
    }, 5000);
}

function stopDemoLiveTicker() {
    if (_demoLiveInterval) { clearInterval(_demoLiveInterval); _demoLiveInterval = null; }
    const ticker = document.getElementById("demo-ticker");
    if (ticker) ticker.style.display = "none";
}

function updateDemoStatus(text, color) {
    const badge = document.getElementById("demo-status-badge");
    if (badge) { badge.textContent = text; badge.style.color = color; badge.style.borderColor = color + "60"; }
}

function showDemoBadge(text) {
    removeDemoBadge();
    const badge = document.createElement("div");
    badge.id = "demo-sim-badge";
    badge.textContent = text;
    document.body.appendChild(badge);
}

function removeDemoBadge() {
    document.getElementById("demo-sim-badge")?.remove();
}

function showDemoLiveStats(total, escalated, breached) {
    const el = document.getElementById("demo-live-stats");
    if (el) el.style.display = "block";
    updateLiveStatCounters(total, escalated, breached);
}

function hideDemoLiveStats() {
    const el = document.getElementById("demo-live-stats");
    if (el) el.style.display = "none";
}

function updateLiveStatCounters(total, escalated, breached) {
    const t = document.getElementById("demo-total");
    const e = document.getElementById("demo-escalated");
    const b = document.getElementById("demo-breached");
    const p = document.getElementById("demo-pressure");
    if (t) t.textContent = total;
    if (e) e.textContent = escalated;
    if (b) b.textContent = breached;
    if (p) {
        const pressure = Math.round((escalated * 25 + breached * 15) / Math.max(total, 1) * 100);
        p.textContent = pressure + "%";
    }
}
