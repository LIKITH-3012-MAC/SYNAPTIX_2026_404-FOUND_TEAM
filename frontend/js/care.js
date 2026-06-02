/**
 * RESOLVIT CARE - Subsystem Logic
 * Manages view switching, Real-time Data fetching, GIS mapping,
 * Overview stats, Volunteer search, and Ops Timeline.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Enforce login for Resolvit Care suite
    if (typeof Auth !== 'undefined') {
        if (!Auth.requireAuth('index.html')) return;
    }
    
    // Dynamic user card update in the sidebar
    const user = Auth.getUser();
    if (user) {
        const userCard = document.querySelector('.care-user-card');
        if (userCard) {
            const initials = (user.username || 'OP').substring(0, 2).toUpperCase();
            const roleLabel = user.role === 'admin' ? 'System Administrator' :
                              user.role === 'ngo' ? 'NGO Operator' :
                              user.role === 'authority' ? 'Department Official' : 'Citizen Reporter';
            
            userCard.innerHTML = `
                <div style="width:36px; height:36px; border-radius:50%; background:#10b981; display:flex; align-items:center; justify-content:center; font-weight:bold; color:black;">${initials}</div>
                <div style="flex:1;">
                  <div style="font-size:0.85rem; font-weight:600; color:white;">${user.username}</div>
                  <div style="font-size:0.75rem; color:#94a3b8;">${roleLabel}</div>
                </div>
                <i class="fas fa-sign-out-alt" style="color:#94a3b8; cursor:pointer;" onclick="Auth.logout()" title="Logout"></i>
            `;
        }

        // --- ROLE-BASED SIDEBAR & TOPBAR UI INITIALIZATION ---
        const role = user.role || 'citizen';
        
        // 1. Hide sidebar items not permitted for this role
        document.querySelectorAll('.care-nav-item').forEach(item => {
            const allowedRoles = item.getAttribute('data-roles');
            if (allowedRoles === 'all' || allowedRoles.split(',').includes(role)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });

        // 2. Control visibility of Admin Control Panels in Command Center
        const adminPanels = document.getElementById('admin-management-panels');
        if (adminPanels) {
            adminPanels.style.display = (role === 'admin') ? 'block' : 'none';
        }

        // 3. Control visibility of Broadcast Alert topbar button
        const broadcastBtn = document.getElementById('topbar-broadcast-btn');
        if (broadcastBtn) {
            broadcastBtn.style.display = (role === 'admin') ? 'inline-flex' : 'none';
        }

        // 4. Populate Hero actions based on role
        const heroActions = document.getElementById('hero-actions-container');
        if (heroActions) {
            if (role === 'admin') {
                heroActions.innerHTML = `
                    <button class="care-btn care-btn-primary" onclick="document.querySelector('[data-target=\\'view-command\\']').click()">Open Command Center</button>
                    <button class="care-btn care-btn-outline" onclick="CareAdmin.openCreateNGOModal()">Register NGO</button>
                `;
            } else if (role === 'ngo') {
                heroActions.innerHTML = `
                    <button class="care-btn care-btn-primary" onclick="document.querySelector('[data-target=\\'view-intake\\']').click()">View Assigned Incidents</button>
                    <button class="care-btn care-btn-outline" onclick="document.querySelector('[data-target=\\'view-tasks\\']').click()">Task Board</button>
                `;
            } else {
                heroActions.innerHTML = `
                    <button class="care-btn care-btn-primary" onclick="document.querySelector('[data-target=\\'view-submit-report\\']').click()">🚨 Report a Need</button>
                    <button class="care-btn care-btn-outline" onclick="document.querySelector('[data-target=\\'view-my-submissions\\']').click()">My Submissions</button>
                `;
            }
        }
    }

    initCareApp();
    fetchRealCareData();
    fetchCareOverview();
    fetchVolunteers();
    fetchOpsTimeline();

    // Init CareAdmin for admin users if available
    if (user && user.role === 'admin' && window.CareAdmin) {
        CareAdmin.init().catch(e => console.warn("[CareAdmin] Init silently failed:", e));
    }

    // Init Citizen features (report submission and history load)
    initCitizenCareFlow();
});

// ═══════════════════════════════════════════════════════════
// CARE OVERVIEW STATS (DB-BACKED)
// ═══════════════════════════════════════════════════════════

async function fetchCareOverview() {
    try {
        const user = Auth.getUser();
        if (!user) return;

        const data = await API.get('/api/care/admin/overview');
        
        const incidentsEl = document.getElementById('care-kpi-incidents');
        const ngosEl = document.getElementById('care-kpi-ngos');
        const volunteersEl = document.getElementById('care-kpi-volunteers');
        const impactEl = document.getElementById('care-kpi-impact');

        if (incidentsEl) incidentsEl.textContent = data.active_incidents || 0;
        if (ngosEl) ngosEl.textContent = data.ngos_connected || 0;
        if (volunteersEl) volunteersEl.textContent = (data.volunteers_available || 0).toLocaleString();
        if (impactEl) impactEl.textContent = (data.lives_impacted || 0).toLocaleString();

        // Also update command center KPIs
        const cmdOpenEl = document.getElementById('care-cmd-open');
        if (cmdOpenEl) cmdOpenEl.textContent = data.active_incidents || 0;

    } catch(e) {
        console.warn("[Care] Overview stats fetch failed (non-critical):", e.message);
    }
}

// ═══════════════════════════════════════════════════════════
// REAL CARE DATA (REPORTS)
// ═══════════════════════════════════════════════════════════

async function fetchRealCareData() {
    try {
        const user = Auth.getUser();
        if (!user) return;
        
        let endpoint = '/api/care/reports/mine';
        if (user.role === 'admin') endpoint = '/api/care/admin/reports';
        else if (user.role === 'ngo') endpoint = '/api/care/ngo/reports';
        
        const reports = await API.get(endpoint);
        console.log("[Care] Fetched live reports:", reports);
        
        renderIntakeFeed(reports);
        updateCommandCenterKPIs(reports);
        renderKanban(reports);
    } catch(e) {
        console.error("[Care] Failed to load live ops data", e);
    }
}

function updateCommandCenterKPIs(reports) {
    const active = reports.filter(r => r.status !== 'resolved' && r.status !== 'closed').length;
    const critical = reports.filter(r => (r.urgency_score || 0) >= 4).length;
    
    const cmdOpenEl = document.getElementById('care-cmd-open');
    const cmdCritEl = document.getElementById('care-cmd-critical');
    if (cmdOpenEl) cmdOpenEl.textContent = active;
    if (cmdCritEl) cmdCritEl.textContent = critical;
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
            if (targetId === 'view-volunteers') {
                fetchVolunteers();
            }
            if (targetId === 'view-timeline') {
                fetchOpsTimeline();
            }
            if (targetId === 'view-my-submissions') {
                fetchMySubmissions();
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════
// INTAKE FEED
// ═══════════════════════════════════════════════════════════

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
                ${Auth.getUser()?.role === 'admin' ? `
                    <div style="margin-top:8px; display:flex; gap:8px;">
                        <button class="care-btn care-btn-outline" style="font-size:0.7rem; padding:4px 10px;" onclick="event.stopPropagation(); CareAdmin.openAssignNGOModal('${r.id}')">Assign NGO</button>
                        <button class="care-btn care-btn-outline" style="font-size:0.7rem; padding:4px 10px; color:#10b981; border-color:rgba(16,185,129,0.3);" onclick="event.stopPropagation(); CareAdmin.openResolveModal('${r.id}')">Resolve</button>
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════════════════════
// KANBAN BOARD
// ═══════════════════════════════════════════════════════════

function renderKanban(reports) {
    const colNew = document.getElementById('kanban-tasks-new');
    const colAssigned = document.getElementById('kanban-tasks-assigned');
    const colProgress = document.getElementById('kanban-tasks-progress');
    const colResolved = document.getElementById('kanban-tasks-resolved');

    if (!colNew || !colAssigned || !colProgress || !colResolved) return;

    // Filter reports into respective statuses
    const newReports = reports.filter(r => ['submitted', 'under_review', 'clarification_needed'].includes(r.status));
    const assignedReports = reports.filter(r => r.status === 'ngo_assigned');
    const progressReports = reports.filter(r => ['in_progress', 'awaiting_admin_review'].includes(r.status));
    const resolvedReports = reports.filter(r => ['resolved', 'closed', 'rejected'].includes(r.status));

    // Update count labels
    document.getElementById('kanban-count-new').textContent = newReports.length;
    document.getElementById('kanban-count-assigned').textContent = assignedReports.length;
    document.getElementById('kanban-count-progress').textContent = progressReports.length;
    document.getElementById('kanban-count-resolved').textContent = resolvedReports.length;

    // Helper to generate empty state HTML
    const getEmptyStateHTML = () => `
        <div class="kanban-empty-state" style="text-align:center; padding:30px 10px; color:#64748b; font-size:0.8rem; border: 1px dashed rgba(255,255,255,0.03); border-radius:10px; background:rgba(0,0,0,0.05);">
            <i class="fas fa-clipboard-list" style="font-size:1.1rem; color:#475569; margin-bottom:6px; display:block;"></i>
            No active cards
        </div>
    `;

    // Helper to render card HTML
    const getCardHTML = (r, borderStyle = '') => {
        const badgeClass = `badge-${r.status}`;
        let statusLabel = r.status.replace('_', ' ');
        if (r.status === 'ngo_assigned') statusLabel = 'Assigned';
        
        return `
            <div class="task-card" draggable="true" data-id="${r.id}" style="${borderStyle}">
                <div class="task-id">${r.complaint_code}</div>
                <div class="task-title">${r.title}</div>
                <div class="task-footer">
                    <div class="badge ${badgeClass}">${statusLabel}</div>
                    <div class="task-avatars">
                        <div class="task-avatar" style="background:#6366f1; color:white; font-size:10px; display:flex; align-items:center; justify-content:center; font-weight:600;">OP</div>
                    </div>
                </div>
            </div>
        `;
    };

    // Populate columns
    colNew.innerHTML = newReports.length ? newReports.map(r => getCardHTML(r)).join('') : getEmptyStateHTML();
    colAssigned.innerHTML = assignedReports.length ? assignedReports.map(r => getCardHTML(r, 'border-left: 2px solid #3b82f6;')).join('') : getEmptyStateHTML();
    colProgress.innerHTML = progressReports.length ? progressReports.map(r => getCardHTML(r, 'border-left: 2px solid #f97316;')).join('') : getEmptyStateHTML();
    colResolved.innerHTML = resolvedReports.length ? resolvedReports.map(r => `
        <div class="task-card" style="opacity: 0.6; border-left: 2px solid #10b981;" data-id="${r.id}">
            <div class="task-id">${r.complaint_code}</div>
            <del class="task-title" style="color:#94a3b8; display:block; margin-bottom:8px;">${r.title}</del>
            <div class="task-footer">
                <div class="badge badge-resolved">Resolved</div>
            </div>
        </div>
    `).join('') : getEmptyStateHTML();

    // Bind dragstart to newly rendered cards
    const cards = document.querySelectorAll('.task-card[draggable="true"]');
    cards.forEach(card => {
        card.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', card.getAttribute('data-id'));
            e.dataTransfer.effectAllowed = 'move';
            card.style.opacity = '0.4';
        });
        
        card.addEventListener('dragend', () => {
            card.style.opacity = '';
        });
    });

    // Initialize drop targets once if not done
    if (!window.kanbanDragAndDropInitialized) {
        initKanbanDragAndDrop();
        window.kanbanDragAndDropInitialized = true;
    }
}

function initKanbanDragAndDrop() {
    const columns = document.querySelectorAll('.kanban-cards');
    columns.forEach(col => {
        col.addEventListener('dragover', e => {
            e.preventDefault();
            col.classList.add('drag-over');
        });
        
        col.addEventListener('dragleave', () => {
            col.classList.remove('drag-over');
        });
        
        col.addEventListener('drop', async e => {
            e.preventDefault();
            col.classList.remove('drag-over');
            
            const reportId = e.dataTransfer.getData('text/plain');
            const targetStatus = col.getAttribute('data-status');
            
            if (!reportId || !targetStatus) return;
            
            try {
                const user = Auth.getUser();
                if (!user) return;
                
                let endpoint = '';
                if (user.role === 'admin') {
                    endpoint = `/api/care/admin/reports/${reportId}/status`;
                } else if (user.role === 'ngo') {
                    endpoint = `/api/care/ngo/reports/${reportId}/status`;
                } else {
                    showToast("Citizens cannot update report status", "warning");
                    return;
                }
                
                showToast("Updating status...", "info");
                
                await API.patch(endpoint, {
                    status: targetStatus,
                    change_reason: "Moved via Kanban drag-and-drop",
                    note: `Status changed to ${targetStatus} using the Task Orchestration board.`
                });
                
                showToast(`Report status updated to ${targetStatus.replace('_', ' ')}!`, "success");
                
                // Fetch fresh data and re-render
                fetchRealCareData();
            } catch (err) {
                console.error("[Kanban] Drop failed:", err);
                showToast("Failed to update report status: " + (err.message || "Unauthorized"), "danger");
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════
// VOLUNTEER SEARCH / FILTER
// ═══════════════════════════════════════════════════════════

async function fetchVolunteers(searchQuery = '') {
    try {
        let url = '/api/care/volunteers';
        if (searchQuery) {
            url += `?skills=${encodeURIComponent(searchQuery)}&languages=${encodeURIComponent(searchQuery)}`;
        }
        
        const volunteers = await API.get(url);
        renderVolunteerGrid(volunteers);
    } catch(e) {
        console.warn("[Care] Volunteer fetch failed:", e.message);
        renderVolunteerGrid([]);
    }
}

function renderVolunteerGrid(volunteers) {
    const grid = document.getElementById('volunteer-grid');
    if (!grid) return;

    if (!volunteers || volunteers.length === 0) {
        grid.innerHTML = `
            <div class="care-panel" style="grid-column: 1/-1; text-align:center; padding:40px;">
                <i class="fas fa-users" style="font-size:2rem; color:#64748b; margin-bottom:12px;"></i>
                <p style="color:#94a3b8;">No volunteers found. ${Auth.getUser()?.role === 'admin' ? '<br><button class="care-btn care-btn-primary" style="margin-top:12px;" onclick="CareAdmin.openCreateVolunteerModal()">+ Register First Volunteer</button>' : ''}</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = volunteers.map(v => {
        const statusColor = v.availability_status === 'available' ? '#10b981' : 
                           v.availability_status === 'deployed' ? '#f97316' : '#64748b';
        const statusLabel = v.availability_status === 'available' ? '🟢 Available' : 
                           v.availability_status === 'deployed' ? '🟠 Deployed' : '⚫ Inactive';

        return `
            <div class="care-panel" style="padding:20px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                    <div>
                        <div style="font-weight:700; color:white; font-size:1rem;">${v.full_name}</div>
                        <div style="color:#64748b; font-size:0.8rem;">${v.email}</div>
                    </div>
                    <span style="font-size:0.75rem; padding:4px 10px; border-radius:20px; background:${statusColor}20; color:${statusColor}; font-weight:700;">${statusLabel}</span>
                </div>
                ${v.skills ? `<div style="margin-bottom:8px;"><span style="color:#94a3b8; font-size:0.75rem; text-transform:uppercase; font-weight:700;">Skills</span><div style="color:#cbd5e1; font-size:0.85rem;">${v.skills}</div></div>` : ''}
                ${v.languages ? `<div style="margin-bottom:8px;"><span style="color:#94a3b8; font-size:0.75rem; text-transform:uppercase; font-weight:700;">Languages</span><div style="color:#cbd5e1; font-size:0.85rem;">${v.languages}</div></div>` : ''}
                ${v.current_region ? `<div><span style="color:#94a3b8; font-size:0.75rem; text-transform:uppercase; font-weight:700;">Region</span><div style="color:#cbd5e1; font-size:0.85rem;">${v.current_region}</div></div>` : ''}
                ${v.ngo_name ? `<div style="margin-top:8px; font-size:0.8rem; color:#818cf8;"><i class="fas fa-building"></i> ${v.ngo_name}</div>` : ''}
            </div>
        `;
    }).join('');
}

// ═══════════════════════════════════════════════════════════
// OPS TIMELINE
// ═══════════════════════════════════════════════════════════

async function fetchOpsTimeline() {
    try {
        const user = Auth.getUser();
        if (!user) return;

        const events = await API.get('/api/care/admin/timeline');
        renderOpsTimeline(events);
    } catch(e) {
        console.warn("[Care] Timeline fetch failed:", e.message);
    }
}

function renderOpsTimeline(events) {
    const timeline = document.getElementById('ops-timeline');
    if (!timeline) return;

    if (!events || events.length === 0) {
        timeline.innerHTML = '<p style="color:#64748b; text-align:center; padding:20px;">No operational events recorded yet.</p>';
        return;
    }

    timeline.innerHTML = events.map(ev => {
        const icon = ev.event_type === 'broadcast' ? 'fa-broadcast-tower' : 
                     ev.title === 'report_created' ? 'fa-file-alt' :
                     ev.title === 'officer_created' ? 'fa-user-plus' :
                     ev.title === 'broadcast_sent' ? 'fa-satellite-dish' :
                     ev.title === 'volunteer_created' ? 'fa-hands-helping' :
                     'fa-circle';
        const color = ev.event_type === 'broadcast' ? '#ef4444' : '#6366f1';
        const time = new Date(ev.created_at).toLocaleString();

        return `
            <div class="timeline-event" style="display:flex; gap:16px; margin-bottom:24px; position:relative;">
                <div style="width:40px; height:40px; border-radius:50%; background:${color}20; border:2px solid ${color}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <i class="fas ${icon}" style="color:${color}; font-size:0.8rem;"></i>
                </div>
                <div style="flex:1;">
                    <div style="font-weight:700; color:white; font-size:0.9rem; text-transform:capitalize;">${(ev.title || '').replace(/_/g, ' ')}</div>
                    <div style="color:#94a3b8; font-size:0.8rem;">${ev.subtitle || ''} ${ev.actor ? `• by ${ev.actor}` : ''}</div>
                    <div style="color:#64748b; font-size:0.75rem; margin-top:4px;"><i class="fas fa-clock"></i> ${time}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ═══════════════════════════════════════════════════════════
// GEO-INTELLIGENCE MAP
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// CITIZEN INTAKE FLOW & HISTORY
// ═══════════════════════════════════════════════════════════

function initCitizenCareFlow() {
    const form = document.getElementById('care-submit-need-form');
    if (!form) return;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = "⏳ Submitting Request...";

        const fd = new FormData(form);
        const payload = {
            title: fd.get('title'),
            category: fd.get('category'),
            description: fd.get('description'),
            location_text: fd.get('location_text') || null,
            district: fd.get('district') || null,
            ward: fd.get('ward') || null,
            urgency_score: parseInt(fd.get('urgency_score')) || 3,
            severity_level: 3 // Default
        };

        try {
            await API.post('/api/care/reports', payload);
            showToast("✅ Humanitarian Request Submitted Successfully", "success");
            form.reset();
            
            // Switch to My Submissions tab
            const submissionsTab = document.querySelector('[data-target="view-my-submissions"]');
            if (submissionsTab) {
                submissionsTab.click();
            } else {
                fetchMySubmissions();
            }
        } catch (err) {
            showToast(`❌ Failed to submit: ${err.message}`, "error");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "🚨 Submit Humanitarian Request";
        }
    };
}

async function fetchMySubmissions() {
    const feedContainer = document.getElementById('my-submissions-feed');
    if (!feedContainer) return;

    feedContainer.innerHTML = '<p style="color:#64748b; padding:20px; text-align:center;">⏳ Loading your submissions...</p>';

    try {
        const reports = await API.get('/api/care/reports/mine');
        if (!reports || reports.length === 0) {
            feedContainer.innerHTML = `
                <div style="text-align:center; padding:40px; color:#94a3b8;">
                    <i class="fas fa-clipboard-list" style="font-size:2.5rem; margin-bottom:12px; opacity:0.5;"></i>
                    <p>You have not submitted any humanitarian requests yet.</p>
                    <button class="care-btn care-btn-primary" style="margin-top:12px; display:inline-block;" onclick="document.querySelector('[data-target=\\'view-submit-report\\']').click()">Report a Need Now</button>
                </div>
            `;
            return;
        }

        feedContainer.innerHTML = reports.map(r => {
            const urgencyColor = r.urgency_score >= 4 ? '#ef4444' : r.urgency_score >= 3 ? '#f97316' : '#10b981';
            const statusLabel = r.status.replace(/_/g, ' ').toUpperCase();
            const dateStr = new Date(r.created_at).toLocaleString();

            return `
                <div class="care-feed-item" style="cursor:default;">
                    <div class="feed-urgency-indicator" style="background:${urgencyColor};"></div>
                    <div class="feed-content">
                        <div class="feed-header">
                            <h4 class="feed-title">${r.title}</h4>
                            <span class="badge" style="background:rgba(99,102,241,0.1); color:#818cf8;">${r.complaint_code}</span>
                        </div>
                        <p style="font-size:0.9rem; color:#cbd5e1; margin:8px 0;">${r.description}</p>
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-top:12px; font-size:0.8rem; color:#94a3b8;">
                            <div>
                                <span><i class="fas fa-calendar-alt"></i> ${dateStr}</span>
                                <span style="margin-left:16px;"><i class="fas fa-tag"></i> ${r.category}</span>
                                ${r.location_text ? `<span style="margin-left:16px;"><i class="fas fa-map-marker-alt"></i> ${r.location_text}</span>` : ''}
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span class="badge badge-${r.status}" style="font-weight:700;">${statusLabel}</span>
                            </div>
                        </div>
                        ${r.resolution_summary ? `
                            <div style="margin-top:16px; padding:12px; border-radius:8px; background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.15);">
                                <div style="font-size:0.75rem; font-weight:700; color:#34d399; text-transform:uppercase; margin-bottom:4px;"><i class="fas fa-check-circle"></i> Resolution Summary</div>
                                <p style="margin:0; font-size:0.85rem; color:#e2e8f0;">${r.resolution_summary}</p>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        feedContainer.innerHTML = `<p style="color:#ef4444; padding:20px; text-align:center;">❌ Failed to load submissions: ${err.message}</p>`;
    }
}

