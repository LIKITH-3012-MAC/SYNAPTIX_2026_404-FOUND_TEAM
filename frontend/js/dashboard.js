/**
 * RESOLVIT - Dashboard Module (dashboard.js)
 * Handles polling, filtering, sorting, and rendering the issue feed.
 */

let _allIssues = [];
let _catFilter = '';
let _statusFilter = '';
let _searchQuery = '';
let _mapInstance = null;
let _mapVisible = false;
let _offset = 0;

/* ── Init ────────────────────────────────────────────────────── */
async function initDashboard() {
    await Promise.all([fetchSummary(), fetchIssues()]);
    setInterval(fetchIssues, 15000);  // Live polling
}

/* ── Platform Summary Stats ──────────────────────────────────── */
async function fetchSummary() {
    try {
        const data = await API.get('/api/metrics/summary');
        document.getElementById('summary-stats').innerHTML = `
      <div class="metric-card">
        <div class="metric-value" id="s-total">0</div>
        <div class="metric-label">Total Issues</div>
      </div>
      <div class="metric-card">
        <div class="metric-value" id="s-active" style="color:var(--orange);">0</div>
        <div class="metric-label">Active</div>
      </div>
      <div class="metric-card">
        <div class="metric-value" id="s-escalated" style="color:var(--red);">0</div>
        <div class="metric-label">Escalated</div>
      </div>
      <div class="metric-card">
        <div class="metric-value" id="s-resolved" style="color:var(--green);">0</div>
        <div class="metric-label">Resolved</div>
      </div>`;
        animateCounter('s-total', data.total_issues || 0);
        animateCounter('s-active', data.active_issues || 0);
        animateCounter('s-escalated', data.escalated_issues || 0);
        animateCounter('s-resolved', data.resolved_issues || 0);
    } catch {
        document.getElementById('summary-stats').innerHTML = '';
    }
}

/* ── Fetch Issues ────────────────────────────────────────────── */
async function fetchIssues() {
    const sortBy = document.getElementById('sort-select')?.value || 'priority_score';
    try {
        const issues = await Issues.list({
            category: _catFilter || undefined,
            status: _statusFilter || undefined,
            sortBy,
            order: 'desc',
            limit: 100,
            offset: 0
        });
        _allIssues = issues;
        _offset = 0;
        renderIssues();
        if (_mapVisible) updateMapMarkers(issues);
    } catch {
        document.getElementById('issues-grid').innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:60px;">
        <div class="empty-state-icon">🔌</div>
        <h3 style="color:var(--text-secondary);">Backend Not Connected</h3>
        <p style="color:var(--text-muted);margin-top:8px;">Start the API server to see live issues.</p>
        <div style="margin-top:24px;padding:16px;background:var(--bg-secondary);border-radius:12px;font-family:monospace;font-size:0.8rem;color:var(--text-secondary);">
          cd backend && uvicorn app:app --reload
        </div>
      </div>`;
    }
}

/* ── Filter & Sort Logic ─────────────────────────────────────── */
function setCatFilter(cat) {
    _catFilter = cat;
    document.querySelectorAll('[data-cat]').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-cat="${cat}"]`)?.classList.add('active');
    fetchIssues();
}

function setStatusFilter(status) {
    _statusFilter = status;
    document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-status="${status}"]`)?.classList.add('active');
    fetchIssues();
}

function filterIssues() {
    _searchQuery = document.getElementById('search-input')?.value?.toLowerCase() || '';
    renderIssues();
}

/* ── Render Issues Grid ──────────────────────────────────────── */
function renderIssues() {
    let filtered = _allIssues;

    if (_searchQuery) {
        filtered = filtered.filter(i =>
            i.title.toLowerCase().includes(_searchQuery) ||
            (i.description || '').toLowerCase().includes(_searchQuery) ||
            i.category.toLowerCase().includes(_searchQuery)
        );
    }

    const grid = document.getElementById('issues-grid');
    const loadMoreBtn = document.getElementById('load-more');

    if (!filtered.length) {
        grid.innerHTML = `
      <div style="grid-column:1/-1;">
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <h3>No issues found</h3>
          <p>Try adjusting your filters, or <a href="submit.html" style="color:var(--accent);">submit a new issue</a>.</p>
        </div>
      </div>`;
        loadMoreBtn && (loadMoreBtn.style.display = 'none');
        return;
    }

    const visible = filtered.slice(0, _offset + 12);
    grid.innerHTML = visible.map(issue => renderIssueCard(issue, { showUpvote: true })).join('');

    // Start live SLA countdowns
    startSlaCountdowns(visible);

    // Animate priority scores on load
    setTimeout(() => animatePriorityScores(), 100);

    if (loadMoreBtn) {
        loadMoreBtn.style.display = visible.length < filtered.length ? 'block' : 'none';
    }
}

function loadMore() {
    _offset += 12;
    renderIssues();
}

/* ── Map Integration ─────────────────────────────────────────── */
function toggleMap() {
    const mapEl = document.getElementById('dashboard-map');
    const btnEl = document.getElementById('map-toggle-btn');
    _mapVisible = !_mapVisible;
    mapEl.style.display = _mapVisible ? 'block' : 'none';
    btnEl.textContent = _mapVisible ? '📋 Hide Map' : '🗺 Show Map View';

    if (_mapVisible && !_mapInstance) {
        // Default to Kavali, AP, India
        _mapInstance = L.map('dashboard-map').setView([14.9282, 79.9900], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(_mapInstance);
        updateMapMarkers(_allIssues);
    } else if (_mapVisible) {
        setTimeout(() => _mapInstance.invalidateSize(), 100);
    }
}

function updateMapMarkers(issues) {
    if (!_mapInstance) return;
    _mapInstance.eachLayer(layer => {
        if (layer instanceof L.Marker) _mapInstance.removeLayer(layer);
    });

    let hasBounds = false;
    const bounds = [];

    issues.forEach(issue => {
        if (!issue.latitude || !issue.longitude) return;
        const score = issue.priority_score || 0;
        const band = typeof getPriorityBand === 'function' ? getPriorityBand(score) : { color: '#6366f1' };
        const color = band.color;
        const size = score >= 80 ? 22 : score >= 55 ? 18 : score >= 30 ? 14 : 12;
        const isPulsing = score >= 80 || issue.sla_breached || issue.escalation_level > 0;

        const icon = L.divIcon({
            className: '',
            html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 2px 12px ${color}66;cursor:pointer;${isPulsing ? 'animation:pulse 1s infinite;' : ''}"></div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
        });

        const slaLine = issue.sla_breached
            ? '<div style="color:#dc2626;font-weight:700;">🔴 SLA BREACHED</div>'
            : issue.sla_seconds_remaining != null && issue.sla_seconds_remaining < 3600
                ? '<div style="color:#ea580c;font-weight:700;">⚠️ SLA &lt; 1h remaining</div>'
                : '';

        L.marker([issue.latitude, issue.longitude], { icon })
            .addTo(_mapInstance)
            .bindPopup(`
        <div style="min-width:220px;font-family:system-ui;">
          <div style="font-weight:700;font-size:0.95rem;margin-bottom:6px;">${escapeHtml(issue.title)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
            <span style="background:${color}20;color:${color};padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:700;">Score: ${score}</span>
            <span style="background:#f1f5f9;padding:2px 8px;border-radius:10px;font-size:0.75rem;">${issue.category}</span>
            <span style="background:#f1f5f9;padding:2px 8px;border-radius:10px;font-size:0.75rem;">${issue.status?.replace('_', ' ')}</span>
          </div>
          <div style="font-size:0.8rem;color:#64748b;">📢 ${issue.report_count || 1} reports · 👍 ${issue.upvotes || 0} upvotes</div>
          ${slaLine}
          ${issue.escalation_level > 0 ? `<div style="color:#dc2626;font-size:0.8rem;font-weight:700;margin-top:4px;">🚨 Escalated (Level ${issue.escalation_level})</div>` : ''}
          <a href="issue.html?id=${issue.id}" style="display:block;margin-top:10px;text-align:center;background:#6366f1;color:white;padding:6px;border-radius:8px;font-size:0.82rem;text-decoration:none;">View Issue →</a>
        </div>`);

        bounds.push([issue.latitude, issue.longitude]);
        hasBounds = true;
    });

    if (hasBounds && bounds.length > 0) {
        try { _mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 }); } catch (e) { }
    }
}

/* ── Priority Score Animation ────────────────────────────────── */
function animatePriorityScores() {
    document.querySelectorAll('.priority-score').forEach(el => {
        const target = parseFloat(el.textContent);
        if (isNaN(target)) return;
        let current = 0;
        const step = target / 20;
        const interval = setInterval(() => {
            current = Math.min(current + step, target);
            el.textContent = current.toFixed(1);
            if (current >= target) clearInterval(interval);
        }, 30);
    });
}
