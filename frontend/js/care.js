/**
 * RESOLVIT CARE - Subsystem Logic
 * Manages view switching, Real-time Data fetching, and GIS mapping
 */

document.addEventListener('DOMContentLoaded', () => {
    // Enforce login for Resolvit Care suite
    if (typeof Auth !== 'undefined') {
        if (!Auth.requireAuth('index.html')) return;
    }
    initCareApp();
    fetchRealCareData();
});

async function fetchRealCareData() {
    try {
        const user = Auth.getUser();
        if (!user) return;
        
        let endpoint = '/api/care/reports/mine';
        if (user.role === 'admin') endpoint = '/api/care/admin/reports';
        else if (user.role === 'ngo_operator') endpoint = '/api/care/ngo/reports';
        
        const reports = await API.get(endpoint);
        console.log("[Care] Fetched live reports:", reports);
        
        renderIntakeFeed(reports);
        updateKPIs(reports);
        renderKanban(reports);
    } catch(e) {
        console.error("[Care] Failed to load live ops data", e);
    }
}

function updateKPIs(reports) {
    const active = reports.filter(r => r.status !== 'resolved' && r.status !== 'closed').length;
    const resolved = reports.filter(r => r.status === 'resolved').length;
    
    const activeEl = document.querySelector('.care-kpi-tile .care-kpi-value.text-red');
    if (activeEl) activeEl.innerText = active;
    
    // In a full implementation, we'd also aggregate NGO and Volunteer counts from their respective APIs
}

function initCareApp() {
    const navItems = document.querySelectorAll('.care-nav-item');
    const views = document.querySelectorAll('.care-view');
    const topbarTitle = document.getElementById('topbar-title');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            const viewName = item.querySelector('span:not(.care-pulse-dot)').innerText;
            topbarTitle.innerText = viewName;
            const targetId = item.getAttribute('data-target');
            views.forEach(v => {
                v.classList.remove('active');
                if (v.id === targetId) v.classList.add('active');
            });
            if (targetId === 'view-geospatial') {
                setTimeout(initCareMap, 100);
            }
        });
    });
}

function renderIntakeFeed(reports) {
    const feedContainer = document.getElementById('intake-feed');
    if(!feedContainer) return;

    if (!reports || reports.length === 0) {
        feedContainer.innerHTML = '<p style="color:#64748b; padding:20px; text-align:center;">No active reports in queue.</p>';
        return;
    }

    feedContainer.innerHTML = reports.map(r => `
        <div class="care-feed-item" onclick="viewReportDetail('${r.id}')">
            <div class="feed-urgency-indicator ${r.urgency_score >= 4 ? 'urgency-crit' : 'urgency-med'}"></div>
            <div class="feed-content">
                <div class="feed-header">
                    <h4 class="feed-title">${r.title}</h4>
                    <span class="badge badge-reported">${r.complaint_code}</span>
                </div>
                <div class="feed-meta mb-2">
                    <span><i class="fas fa-clock"></i> ${new Date(r.created_at).toLocaleTimeString()}</span>
                    ${r.urgency_score >= 4 ? '<span class="text-red" style="margin-left:8px;"><i class="fas fa-exclamation-triangle"></i> Critical</span>' : ''}
                </div>
                <div class="ai-insight-label" style="font-size: 0.7rem;"><i class="fas fa-robot"></i> Operational Triage</div>
                <p style="font-size: 0.8rem; color: #cbd5e1; margin: 0;">Status: <strong>${r.status.toUpperCase()}</strong> | Assigned to: ${r.assigned_ngo_id || 'Seeking NGO...'}</p>
            </div>
        </div>
    `).join('');
}

function renderKanban(reports) {
    const kanban = document.getElementById('kanban-tasks-progress');
    if(!kanban) return;

    const inProgress = reports.filter(r => r.status === 'in_progress' || r.status === 'ngo_assigned');

    kanban.innerHTML = inProgress.map(r => `
        <div class="task-card" draggable="true">
            <div class="task-id">${r.complaint_code}</div>
            <div class="task-title">${r.title}</div>
            <div class="task-footer">
                <div class="badge badge-in_progress"><i class="fas fa-spinner fa-spin"></i> ${r.status}</div>
                <div class="task-avatars">
                    <div class="task-avatar" style="background:#6366f1; color:white; font-size:10px; display:flex; align-items:center; justify-content:center;">OP</div>
                </div>
            </div>
        </div>
    `).join('');
}

let careMapInstance = null;
let markerClusterGroup = null;

async function initCareMap() {
    if (careMapInstance) {
        careMapInstance.invalidateSize();
        return;
    }

    const mapContainer = document.getElementById('care-intelligence-map');
    if(!mapContainer || !window.L) return;

    careMapInstance = L.map('care-intelligence-map', {
        center: [14.9150, 79.9900], // Kavali center
        zoom: 13,
        zoomControl: false,
        attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(careMapInstance);

    markerClusterGroup = L.markerClusterGroup({
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true
    });

    try {
        const points = await API.get('/api/care/map-data');
        points.forEach(p => {
            const marker = L.circleMarker([p.latitude, p.longitude], {
                radius: 10,
                color: p.urgency_score >= 4 ? '#ef4444' : '#3b82f6',
                fillColor: p.urgency_score >= 4 ? '#ef4444' : '#3b82f6',
                fillOpacity: 0.6,
                weight: 2
            });
            
            marker.bindPopup(`
                <div style="color:black;">
                    <strong style="display:block; margin-bottom:4px;">${p.complaint_code}</strong>
                    <p style="margin:0 0 8px 0; font-size:0.85rem;">${p.title}</p>
                    <span class="badge" style="background:#6366f1; color:white;">Status: ${p.status}</span>
                </div>
            `);
            markerClusterGroup.addLayer(marker);
        });
        careMapInstance.addLayer(markerClusterGroup);
        if (points.length > 0) {
            careMapInstance.fitBounds(markerClusterGroup.getBounds(), { padding: [50, 50] });
        }
    } catch (e) {
        console.error("Map Data Fail:", e);
    }
}

function viewReportDetail(id) {
    if (window.DetailManager) {
        DetailManager.open(id, 'care');
    }
}
