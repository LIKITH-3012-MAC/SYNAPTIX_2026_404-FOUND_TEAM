/**
 * RESOLVIT - Unified Detail Manager v2
 * Zero-defect side-drawer system for issue inspection and updates.
 * Used by Admin Heatmap, Authority Portal, and Public Feed.
 */

const DetailManager = {
    currentIssueId: null,
    isOpen: false,
    selectedIssueId: null, // Stable global state
    _abortController: null,

    init() {
        if (document.getElementById('issue-detail-drawer')) return;

        const drawer = document.createElement('div');
        drawer.id = 'issue-detail-drawer';
        drawer.className = 'detail-drawer';
        drawer.innerHTML = `
            <div class="drawer-overlay" onclick="DetailManager.close()"></div>
            <div class="drawer-content glass-card-premium">
                <div class="drawer-header">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <div id="drawer-icon" style="font-size:1.5rem;">📌</div>
                        <div>
                            <h2 id="drawer-title" style="margin:0;font-size:1.2rem;font-weight:800;color:white;">Issue Details</h2>
                            <div id="drawer-tracking-id" style="font-size:0.7rem;color:var(--text-muted);font-weight:700;letter-spacing:1px;margin-top:2px;">#TRACKING-ID</div>
                        </div>
                    </div>
                    <button class="drawer-close" onclick="DetailManager.close()">×</button>
                </div>
                
                <div class="drawer-body custom-scrollbar">
                    <!-- Status / Priority Banner -->
                    <div id="drawer-banner" class="drawer-section banner-glow" style="display:flex;justify-content:space-between;align-items:center;padding:16px;border-radius:12px;margin-bottom:20px;">
                        <div>
                            <div class="badge-label">STATUS</div>
                            <div id="drawer-status-badge" class="badge">REPORTED</div>
                        </div>
                        <div style="text-align:right;">
                            <div class="badge-label">PRIORITY SCORE</div>
                            <div id="drawer-priority-score" style="font-size:1.8rem;font-weight:900;line-height:1;margin-top:4px;">0</div>
                        </div>
                    </div>

                    <!-- Main Info -->
                    <div class="drawer-section">
                        <label class="detail-label">Description</label>
                        <p id="drawer-description" class="detail-text" style="line-height:1.6;color:var(--text-secondary);"></p>
                    </div>

                    <div class="detail-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
                        <div>
                            <label class="detail-label">Category</label>
                            <div id="drawer-category" class="detail-val">Roads</div>
                        </div>
                        <div>
                            <label class="detail-label">Subcategory</label>
                            <div id="drawer-subcategory" class="detail-val">—</div>
                        </div>
                        <div>
                            <label class="detail-label">Reporter</label>
                            <div id="drawer-reporter" class="detail-val">Citizen</div>
                        </div>
                        <div>
                            <label class="detail-label">Reported On</label>
                            <div id="drawer-date" class="detail-val">2026-03-18</div>
                        </div>
                    </div>

                    <!-- SLA Box -->
                    <div id="drawer-sla-box" class="glass-inset" style="padding:16px;border-radius:12px;margin-bottom:24px;border-left:4px solid var(--accent);">
                        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                            <span style="font-size:0.75rem;font-weight:700;color:var(--text-secondary);">SLA COMPLIANCE</span>
                            <span id="drawer-sla-timer" style="font-family:'JetBrains Mono',monospace;font-size:0.8rem;font-weight:800;">PENDING</span>
                        </div>
                        <div class="progress-bar-minimal"><div id="drawer-sla-bar" class="progress-fill"></div></div>
                    </div>

                    <!-- Update Controls (Admin/Authority Only) -->
                    <div id="drawer-update-section" class="drawer-section hidden">
                        <h3 style="font-size:1rem;font-weight:800;margin-bottom:16px;color:var(--accent);">Operational Controls</h3>
                        <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                            <div class="form-group" style="grid-column: span 2;">
                                <label class="form-label">Change Status</label>
                                <select id="update-status" class="form-select">
                                    <option value="reported">Reported</option>
                                    <option value="verified">Verified</option>
                                    <option value="assigned">Assigned</option>
                                    <option value="in_progress">In Progress</option>
                                    <option value="escalated">Escalated</option>
                                    <option value="resolved">Resolved</option>
                                    <option value="archived">Archived</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Urgency (1-5)</label>
                                <input type="number" id="update-urgency" class="form-input" min="1" max="5">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Impact Scale</label>
                                <input type="number" id="update-impact" class="form-input" min="1">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Escalation Level (0-3)</label>
                                <input type="number" id="update-escalation" class="form-input" min="0" max="3">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Latitude</label>
                                <input type="number" id="update-lat" class="form-input" step="any">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Longitude</label>
                                <input type="number" id="update-lng" class="form-input" step="any">
                            </div>
                            <div class="form-group" style="grid-column: span 2;">
                                <label class="form-label">Priority Score (Override)</label>
                                <input type="number" id="update-priority" class="form-input" step="0.1" placeholder="Manual override...">
                            </div>
                            <div class="form-group" style="grid-column: span 2;">
                                <label class="form-label">Assigned Authority (User ID)</label>
                                <input type="text" id="update-assigned" class="form-input" placeholder="Enter Authority UUID...">
                            </div>
                            <div class="form-group" style="grid-column: span 2;">
                                <label class="form-label">Override SLA / Due Date</label>
                                <input type="datetime-local" id="update-sla" class="form-input">
                            </div>
                            <div class="form-group" style="grid-column: span 2;">
                                <label class="form-label">Resolution Proof URL (Image/Doc)</label>
                                <input type="text" id="update-proof" class="form-input" placeholder="https://...">
                            </div>
                            <div class="form-group" style="grid-column: span 2;">
                                <label class="form-label">Resolution Summary / Authority Note</label>
                                <textarea id="update-note" class="form-textarea" placeholder="Detail the specific actions taken for resolution..."></textarea>
                            </div>
                            <button id="btn-save-update" class="btn btn-primary" onclick="DetailManager.submitUpdate()" style="grid-column: span 2; padding:14px;">Commit MASTER Update</button>
                        </div>
                    </div>

                    <!-- Timeline -->
                    <div class="drawer-section" style="margin-top:32px;">
                        <h3 style="font-size:1rem;font-weight:800;margin-bottom:16px;">Issue Lifecycle Timeline</h3>
                        <div id="drawer-timeline" class="timeline-v2">
                            <!-- Populated dynamically -->
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(drawer);

        // Add Styles
        const style = document.createElement('style');
        style.textContent = `
            .detail-drawer { position: fixed; inset: 0; z-index: 9999; visibility: hidden; pointer-events: none; }
            .detail-drawer.active { visibility: visible; pointer-events: auto; }
            .drawer-overlay { position: absolute; inset: 0; background: rgba(2,6,23,0.7); backdrop-filter: blur(8px); opacity: 0; transition: opacity 0.4s; }
            .detail-drawer.active .drawer-overlay { opacity: 1; }
            .drawer-content { 
                position: absolute; right: 0; top: 0; bottom: 0; width: 440px; 
                background: #0f172a; border-left: 1px solid rgba(255,255,255,0.06);
                transform: translateX(100%); transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                display: flex; flex-direction: column; overflow: hidden;
                box-shadow: -20px 0 50px rgba(0,0,0,0.5);
            }
            .detail-drawer.active .drawer-content { transform: translateX(0); }
            @media (max-width: 480px) { .drawer-content { width: 100%; } }
            
            .drawer-header { padding: 24px; border-bottom: 1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center; }
            .drawer-body { flex: 1; padding: 24px; overflow-y: auto; }
            .drawer-close { background: none; border: none; font-size: 2rem; color: #94a3b8; cursor: pointer; line-height: 1; }
            
            .detail-label { font-size: 0.62rem; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px; }
            .detail-val { font-size: 0.9rem; font-weight: 700; color: #e2e8f0; }
            .badge-label { font-size: 0.62rem; font-weight: 800; color: rgba(255,255,255,0.6); letter-spacing: 1px; }

            .progress-bar-minimal { height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; margin-top: 10px; }
            .progress-fill { height: 100%; width: 0%; background: var(--accent); transition: width 1s ease; }

            .timeline-v2 { position: relative; padding-left: 24px; border-left: 1px solid rgba(255,255,255,0.06); margin-left: 8px; }
            .timeline-item { position: relative; margin-bottom: 24px; }
            .timeline-item::before { content: ""; position: absolute; left: -29px; top: 4px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); white-space: nowrap; border: 2px solid #0f172a; z-index: 10; }
            .timeline-time { font-size: 0.65rem; color: #64748b; font-weight: 700; margin-bottom: 4px; }
            .timeline-title { font-size: 0.85rem; font-weight: 700; color: #f8fafc; }
            .timeline-actor { font-size: 0.72rem; color: var(--accent); margin-top: 2px; }
            .timeline-note { font-size: 0.75rem; color: #94a3b8; font-style: italic; margin-top: 6px; background: rgba(255,255,255,0.03); padding: 8px; border-radius: 6px; }

            .banner-glow { box-shadow: 0 0 20px rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.1); }
            .hidden { display: none !important; }
        `;
        document.head.appendChild(style);
    },

    async open(issueId) {
        this.init();
        const user = Auth.getUser();
        if (!user) {
            showToast('Please login to view details', 'error');
            return;
        }

        const isSoftRefresh = this.isOpen && this.currentIssueId === issueId;
        
        // CANCEL previous pending request to prevent race condition flicker
        if (this._abortController) this._abortController.abort();
        this._abortController = new AbortController();
        const { signal } = this._abortController;

        this.currentIssueId = issueId;
        this.selectedIssueId = issueId;
        this.isOpen = true;

        const drawer = document.getElementById('issue-detail-drawer');
        drawer.classList.add('active');

        // Only show heavy loading if it's a new issue selection
        if (!isSoftRefresh) {
            this.setLoading(true);
        } else {
             // SOFT VISUAL INDICATOR
             document.getElementById('drawer-title').innerHTML += `<span id="drawer-updating-tag" style="margin-left:8px;font-size:0.65rem;color:var(--accent);vertical-align:middle;animation:pulse 1s infinite;">Updating...</span>`;
             document.getElementById('drawer-body').style.opacity = '0.82';
        }

        try {
            const [issue, history] = await Promise.all([
                API.get(`/api/issues/${issueId}`, { signal }),
                API.get(`/api/issues/${issueId}/history`, { signal })
            ]);

            this.render(issue, history, user);
        } catch (err) {
            if (err.name === 'AbortError') return; // Ignore cancelled requests
            console.error(err);
            showToast('Failed to load issue details', 'error');
            this.close();
        } finally {
            this.setLoading(false);
            const tag = document.getElementById('drawer-updating-tag');
            if (tag) tag.remove();
        }
    },

    setLoading(loading) {
        if (loading) {
            document.getElementById('drawer-title').textContent = 'Initialising...';
            document.getElementById('drawer-description').textContent = '';
            document.getElementById('drawer-priority-score').textContent = '0';
            document.getElementById('drawer-timeline').innerHTML = '';
            document.getElementById('drawer-body').style.opacity = '0.5';
        } else {
            document.getElementById('drawer-body').style.opacity = '1';
        }
    },

    render(issue, history, user) {
        const icons = { Roads: "🛣️", Water: "💧", Electricity: "⚡", Sanitation: "🗑️", Safety: "🚨", Environment: "🌿", Other: "📌" };
        
        document.getElementById('drawer-icon').textContent = icons[issue.category] || "📌";
        document.getElementById('drawer-title').textContent = issue.title;
        document.getElementById('drawer-tracking-id').textContent = `#${issue.id.toUpperCase()}`;
        
        const score = issue.priority_score || 0;
        const scoreEl = document.getElementById('drawer-priority-score');
        scoreEl.textContent = Math.round(score);
        scoreEl.style.color = score >= 80 ? 'var(--red)' : score >= 55 ? 'var(--orange)' : score >= 30 ? 'var(--yellow)' : 'var(--green)';

        const statusBadge = document.getElementById('drawer-status-badge');
        statusBadge.textContent = issue.status.toUpperCase().replace('_', ' ');
        statusBadge.className = `badge badge-${issue.status}`;
        
        document.getElementById('drawer-description').textContent = issue.description;
        document.getElementById('drawer-category').textContent = issue.category;
        document.getElementById('drawer-subcategory').textContent = issue.subcategory || '—';
        document.getElementById('drawer-reporter').textContent = issue.reporter_full_name || issue.reporter_name || 'Anonymous';
        document.getElementById('drawer-date').textContent = new Date(issue.created_at).toLocaleString();

        // SLA
        const slaTimer = document.getElementById('drawer-sla-timer');
        const slaBar = document.getElementById('drawer-sla-bar');
        if (issue.status === 'resolved') {
            slaTimer.textContent = 'RESOLVED';
            slaTimer.style.color = 'var(--green)';
            slaBar.style.width = '100%';
            slaBar.style.background = 'var(--green)';
        } else if (issue.sla_seconds_remaining != null) {
            const h = Math.floor(issue.sla_seconds_remaining / 3600);
            if (h <= 0) {
                slaTimer.textContent = 'BREACHED';
                slaTimer.style.color = 'var(--red)';
                slaBar.style.width = '100%';
                slaBar.style.background = 'var(--red)';
            } else {
                slaTimer.textContent = `${h}h REMAINING`;
                slaTimer.style.color = h < 12 ? 'var(--orange)' : 'var(--accent)';
                const pct = Math.max(0, Math.min(100, (issue.sla_seconds_remaining / (issue.sla_hours * 3600)) * 100));
                slaBar.style.width = `${pct}%`;
                slaBar.style.background = pct < 25 ? 'var(--red)' : 'var(--accent)';
            }
        }

        // Operational Controls
        const updateSec = document.getElementById('drawer-update-section');
        if (user.role === 'admin' || user.role === 'authority') {
            updateSec.classList.remove('hidden');
            document.getElementById('update-status').value = issue.status;
            document.getElementById('update-urgency').value = issue.urgency;
            document.getElementById('update-impact').value = issue.impact_scale;
            document.getElementById('update-lat').value = issue.latitude || '';
            document.getElementById('update-lng').value = issue.longitude || '';
            
            if (issue.sla_due_at) {
                const d = new Date(issue.sla_due_at);
                const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                document.getElementById('update-sla').value = local;
            } else {
                document.getElementById('update-sla').value = '';
            }
            
            document.getElementById('update-priority').value = issue.priority_score || '';
            document.getElementById('update-assigned').value = issue.assigned_authority_id || '';
            document.getElementById('update-escalation').value = issue.escalation_level || 0;
            document.getElementById('update-proof').value = issue.resolution_proof_url || '';
            document.getElementById('update-note').value = issue.resolution_note || '';
        } else {
            updateSec.classList.add('hidden');
        }

        // Timeline
        const timelineEl = document.getElementById('drawer-timeline');
        if (!history.length) {
            timelineEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;">Initial report logged. No further movement.</div>';
        } else {
            timelineEl.innerHTML = history.reverse().map(h => `
                <div class="timeline-item">
                    <div class="timeline-time">${new Date(h.created_at).toLocaleString()}</div>
                    <div class="timeline-title">${h.action_type.replace('_', ' ').toUpperCase()}</div>
                    <div class="timeline-actor">By: ${h.actor_role?.toUpperCase() || 'SYSTEM'} (#${h.actor_id?.slice(-6) || '---'})</div>
                    ${h.note ? `<div class="timeline-note">${h.note}</div>` : ''}
                </div>
            `).join('');
        }
    },

    close() {
        document.getElementById('issue-detail-drawer').classList.remove('active');
        this.isOpen = false;
        this.currentIssueId = null;
    },

    async submitUpdate() {
        const id = this.currentIssueId;
        const btn = document.getElementById('btn-save-update');
        const originalText = btn.textContent;
        
        const payload = {
            status: document.getElementById('update-status').value,
            urgency: parseInt(document.getElementById('update-urgency').value),
            impact_scale: parseInt(document.getElementById('update-impact').value),
            latitude: parseFloat(document.getElementById('update-lat').value) || null,
            longitude: parseFloat(document.getElementById('update-lng').value) || null,
            priority_score: parseFloat(document.getElementById('update-priority').value) || null,
            assigned_authority_id: document.getElementById('update-assigned').value || null,
            escalation_level: parseInt(document.getElementById('update-escalation').value) || 0,
            resolution_proof_url: document.getElementById('update-proof').value || null,
            resolution_note: document.getElementById('update-note').value
        };

        const slaVal = document.getElementById('update-sla').value;
        if (slaVal) payload.sla_due_at = new Date(slaVal).toISOString();

        if (payload.status === 'resolved' && !payload.resolution_note) {
            showToast('Resolution note is required for status "resolved".', 'error');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'PERSISTING...';

        try {
            await API.patch(`/api/issues/${id}`, payload);
            showToast('✅ Operational state successfully updated in PostgreSQL.', 'success');
            
            // Re-fetch details to sync UI
            await this.open(id);

            // Sync other components
            if (typeof loadIssues === 'function') loadIssues();
            if (typeof fetchIssues === 'function') fetchIssues();
            if (typeof loadEscalations === 'function') loadEscalations();
            if (typeof loadPressureBoard === 'function') loadPressureBoard();
            
            // Sync Map
            const map = MapManager.getMap();
            if (map && typeof MapManager.updateData === 'function') {
                const issues = await API.getIssues();
                MapManager.updateData(issues, Auth.getUser()?.role);
            }

        } catch (err) {
            console.error(err);
            showToast(`❌ Update failed: ${err.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
};

window.DetailManager = DetailManager;
