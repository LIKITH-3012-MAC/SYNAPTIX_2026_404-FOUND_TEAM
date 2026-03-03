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
        const params = {
            category: _catFilter && _catFilter !== 'undefined' ? _catFilter : undefined,
            status: _statusFilter && _statusFilter !== 'undefined' ? _statusFilter : undefined,
            sort_by: sortBy,
            order: 'desc',
            limit: 100,
            offset: 0
        };
        const issues = await Issues.list(params);
        _allIssues = issues;
        _offset = 0;
        renderIssues();

        if (_mapVisible) {
            MapManager.updateData(issues, Auth.getUser()?.role);
        }
    } catch {
        document.getElementById('issues-grid').innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:60px;">
        <div class="empty-state-icon">🔌</div>
        <h3 style="color:var(--text-secondary);">Backend Not Connected</h3>
        <p style="color:var(--text-muted);margin-top:8px;">Start the API server to see live issues.</p>
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
    const user = Auth.getUser();
    const isAuth = user && (user.role === 'authority' || user.role === 'admin');
    grid.innerHTML = visible.map(issue => renderIssueCard(issue, { showUpvote: true, showUpdateBtn: isAuth })).join('');

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

    if (_mapVisible) {
        // Use Global MapManager Singleton
        MapManager.init('dashboard-map');
        MapManager.updateData(_allIssues, Auth.getUser()?.role);
    }
}

/* ── Gamification Integration ──────────────────────────────────── */
async function initGamificationUI() {
    const profile = await Gamification.getProfile();
    const user = Auth.getUser();
    if (!profile || !user) return;

    const pointsEl = document.getElementById('user-points');
    const progressEl = document.getElementById('user-progress');
    const infoEl = document.getElementById('user-gamify-info');

    if (pointsEl) pointsEl.textContent = profile.points.toLocaleString();
    if (progressEl) {
        const pct = Math.min(100, (profile.points / 1000) * 100);
        progressEl.style.width = pct + '%';
    }

    // Render Leaderboard
    const leaderboardList = document.getElementById('leaderboard-list');
    if (leaderboardList) {
        // Mock data for hackathon
        const mockLeaders = [
            { name: "Likith Naidu", pts: 2450, icon: "🛡️" },
            { name: "Srujan", pts: 1820, icon: "⚔️" },
            { name: "Civic_Guardian", pts: 1200, icon: "🎖️" },
            { name: user.username, pts: profile.points, icon: "👤", current: true }
        ].sort((a, b) => b.pts - a.pts);

        leaderboardList.innerHTML = mockLeaders.map((u, idx) => `
            <div class="flex justify-between items-center" style="padding:8px; border-radius:8px; ${u.current ? 'background:rgba(99,102,241,0.2); border:1px solid var(--accent);' : ''}">
                <div class="flex items-center gap-3">
                    <span style="font-size:0.8rem; font-weight:800; color:var(--text-muted); width:20px;">#${idx + 1}</span>
                    <span style="font-size:1.2rem;">${u.icon}</span>
                    <span style="font-size:0.85rem; font-weight:700;">${u.name}</span>
                </div>
                <span style="font-size:0.85rem; font-weight:900; color:var(--accent);">${u.pts}</span>
            </div>
        `).join('');
    }
}

/* ── Initialization ────────────────────────────────────────────── */
async function initDashboard() {
    await fetchIssues();
    await fetchSummary();
    await initGamificationUI();
}

// Re-expose to global
window.initDashboard = initDashboard;
window.fetchIssues = fetchIssues;
window.filterIssues = filterIssues;
window.toggleMap = toggleMap;
window.loadMore = loadMore;
