/**
 * RESOLVIT - Resolution Hub v3 (Command Engine)
 * Unified, state-driven, real-time issue command system.
 * 
 * REQUIRED SYSTEM ARCHITECTURE:
 * 1. SINGLE SOURCE OF TRUTH (selectedIssueId)
 * 2. EVENT FLOW (STRICT PIPELINE)
 * 3. ENTRY POINT NORMALIZATION
 * 4. URL-DRIVEN ARCHITECTURE
 */

const ResolutionHub = {
    selectedIssueId: null,
    isOpen: false,
    _abortController: null,
    _updateInterval: null,

    /**
     * Initialize the Hub and handle URL-based selection
     */
    init() {
        if (document.getElementById('resolution-hub-drawer')) return;

        // Create the UI structure
        const hub = document.createElement('div');
        hub.id = 'resolution-hub-drawer';
        hub.className = 'resolution-hub';
        hub.innerHTML = `
            <div class="hub-overlay" onclick="ResolutionHub.close()"></div>
            <div class="hub-container glass-card-premium">
                <!-- Header: Identity Layer -->
                <div class="hub-header">
                    <div class="header-main">
                        <div id="hub-icon" class="hub-identity-icon">📌</div>
                        <div class="header-titles">
                            <h2 id="hub-title">Initialising Hub...</h2>
                            <div class="header-meta">
                                <span id="hub-tracking-id">#FETCHING</span>
                                <span class="meta-sep">|</span>
                                <span id="hub-quick-status" class="status-indicator">OFFLINE</span>
                                <button class="btn-copy-id" onclick="ResolutionHub.copyId()" title="Copy ID">📋</button>
                            </div>
                        </div>
                    </div>
                    <div class="header-actions">
                        <button class="hub-close" onclick="ResolutionHub.close()">×</button>
                    </div>
                </div>

                <div class="hub-body custom-scrollbar" data-lenis-prevent>
                    <!-- TOP ALERT BANNER (Pulse for critical) -->
                    <div id="hub-alert-banner" class="hub-banner hidden">
                        <span id="hub-alert-text">CRITICAL SYSTEM ALERT</span>
                    </div>

                    <!-- MODULE 1: SLA ENGINE (LIVE COUNTDOWN) -->
                    <div class="hub-module sla-module">
                        <div class="module-header">
                            <label>SLA COMMAND CENTER</label>
                            <span id="hub-sla-status" class="sla-status-badge">PENDING</span>
                        </div>
                        <div class="sla-progress-wrap">
                            <div id="hub-sla-bar" class="sla-bar-fill"></div>
                        </div>
                        <div class="sla-footer">
                            <span id="hub-sla-timer" class="sla-timer-text">--:--:--</span>
                            <span id="hub-sla-risk" class="sla-risk-label">RISK: LOW</span>
                        </div>
                    </div>

                    <!-- MODULE 2: GEO INTELLIGENCE -->
                    <div class="hub-module geo-module">
                        <label>GEO INTELLIGENCE LAYER</label>
                        <div id="hub-map-container" class="hub-mini-map"></div>
                        <div class="geo-meta">
                            <div class="geo-item">
                                <span class="geo-label">ADDRESS</span>
                                <span id="hub-address" class="geo-val">Locating...</span>
                            </div>
                            <div class="geo-grid">
                                <div class="geo-item">
                                    <span class="geo-label">WARD</span>
                                    <span id="hub-ward" class="geo-val">—</span>
                                </div>
                                <div class="geo-item">
                                    <span class="geo-label">DISTRICT</span>
                                    <span id="hub-district" class="geo-val">—</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- MODULE 3: ISSUE CONTEXT -->
                    <div class="hub-module context-module">
                        <label>ISSUE CONTEXT</label>
                        <div class="context-content">
                            <p id="hub-description" class="issue-desc"></p>
                        </div>
                        <div class="context-grid">
                            <div class="context-item">
                                <label>CATEGORY</label>
                                <div id="hub-category" class="val-bold">—</div>
                            </div>
                            <div class="context-item">
                                <label>SUBCATEGORY</label>
                                <div id="hub-subcategory" class="val-bold">—</div>
                            </div>
                            <div class="context-item">
                                <label>PRIORITY SCORE</label>
                                <div id="hub-priority-score" class="val-score">0</div>
                            </div>
                            <div class="context-item">
                                <label>AI RISK LEVEL</label>
                                <div id="hub-ai-risk" class="val-bold">0%</div>
                            </div>
                        </div>
                    </div>

                    <!-- MODULE 4: REPORTER INTELLIGENCE -->
                    <div class="hub-module reporter-module">
                        <label>REPORTER INTELLIGENCE</label>
                        <div class="reporter-card">
                            <div id="hub-reporter-avatar" class="reporter-avatar">👤</div>
                            <div class="reporter-info">
                                <div id="hub-reporter-name" class="reporter-name">Citizen</div>
                                <div class="reporter-stats">
                                    <span id="hub-reporter-score" class="trust-score">TRUST: --</span>
                                </div>
                            </div>
                            <button class="btn-sm btn-outline" onclick="ResolutionHub.viewReporterProfile()">Profile</button>
                        </div>
                    </div>

                    <!-- MODULE 5: EVIDENCE ENGINE -->
                    <div class="hub-module evidence-module">
                        <label>EVIDENCE ENGINE</label>
                        <div id="hub-evidence-gallery" class="evidence-gallery">
                            <!-- Populated dynamic -->
                        </div>
                    </div>

                    <!-- MODULE 6: TIMELINE ENGINE -->
                    <div class="hub-module timeline-module">
                        <label>LIFECYCLE TIMELINE</label>
                        <div id="hub-timeline" class="hub-timeline-v3">
                            <!-- Populated dynamic -->
                        </div>
                    </div>

                    <!-- MODULE 7: DECISION ENGINE (CONTROLS) -->
                    <div id="hub-decision-engine" class="hub-module decision-module hidden">
                        <div class="module-header">
                            <label>DECISION ENGINE</label>
                            <span class="auth-tag">ADMIN/AUTHORITY ONLY</span>
                        </div>
                        <div class="decision-grid">
                            <div class="form-group full">
                                <label>TRANSITION STATUS</label>
                                <select id="h-update-status" class="hub-select">
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
                                <label>URGENCY (1-5)</label>
                                <input type="number" id="h-update-urgency" min="1" max="5" class="hub-input">
                            </div>
                            <div class="form-group">
                                <label>IMPACT (1-10)</label>
                                <input type="number" id="h-update-impact" min="1" max="10" class="hub-input">
                            </div>
                            <div class="form-group full">
                                <label>ASSIGNED AUTHORITY</label>
                                <input type="text" id="h-update-assigned" placeholder="UUID of Dept/Authority" class="hub-input">
                            </div>
                            <div class="form-group full">
                                <label>RESOLUTION NOTE / AUDIT COMMENT</label>
                                <textarea id="h-update-note" placeholder="Provide full context for this transition..." class="hub-textarea"></textarea>
                            </div>
                            <button id="hub-btn-save" class="hub-btn-primary" onclick="ResolutionHub.commitUpdate()">EXECUTE TRANSACTION</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(hub);

        // Inject advanced Hub styles
        this._injectStyles();

        // Listen for URL changes (Browser Back/Forward)
        window.addEventListener('popstate', () => this._handleUrlSelection());
        
        // Initial check
        this._handleUrlSelection();
    },

    /**
     * Entry Point Normalization: Set State & Trigger Pipeline
     */
    async open(issueId, source = 'direct') {
        if (!issueId) return;
        
        console.log(`[ResolutionHub] Opening issue ${issueId} from ${source}`);
        
        // Update URL to persist state (URL-Driven Architecture)
        const url = new URL(window.location);
        url.searchParams.set('selected', issueId);
        window.history.pushState({ issueId }, '', url);

        // Core Pipeline Execution
        await this._loadIssuePipeline(issueId);
    },

    /**
     * Main Pipeline: State -> Fetch -> Render -> Actions
     */
    async _loadIssuePipeline(issueId) {
        this.init();
        const user = typeof Auth !== 'undefined' ? Auth.getUser() : null;
        if (!user) {
            showToast('Authentication required for Command Engine', 'error');
            return;
        }

        // 1. SET STATE
        this.selectedIssueId = issueId;
        this.isOpen = true;

        // Visual Feedback
        const drawer = document.getElementById('resolution-hub-drawer');
        drawer.classList.add('active');

        // 2. FETCH DATA (Atomic)
        if (this._abortController) this._abortController.abort();
        this._abortController = new AbortController();
        const { signal } = this._abortController;

        this._setLoadingState(true);

        try {
            const [issue, history] = await Promise.all([
                API.get(`/api/issues/${issueId}`, { signal }),
                API.get(`/api/issues/${issueId}/history`, { signal })
            ]);

            // 3. RENDER MODULES
            this._renderHub(issue, history, user);

            // 4. ENABLE ACTIONS
            this._enableActions(user);

            // 5. START REAL-TIME SUB-ENGINE (SLA Countdowns, etc)
            this._startLiveEngines(issue);

            // Center map if MapManager exists
            if (window.MapManager && issue.latitude && issue.longitude) {
                const map = window.MapManager.getMap();
                if (map) map.setView([issue.latitude, issue.longitude], 17);
            }

        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('[ResolutionHub] Pipeline Error:', err);
            showToast('Command Engine: Atomic Fetch Failed', 'error');
            this.close();
        } finally {
            this._setLoadingState(false);
        }
    },

    _renderHub(issue, history, user) {
        const icons = { Roads: "🛣️", Water: "💧", Electricity: "⚡", Sanitation: "🗑️", Safety: "🚨", Environment: "🌿", Other: "📌" };
        
        // Identity Layer
        document.getElementById('hub-icon').textContent = icons[issue.category] || "📌";
        document.getElementById('hub-title').textContent = issue.title;
        document.getElementById('hub-tracking-id').textContent = `#${(issue.tracking_id || issue.id.slice(0,8)).toUpperCase()}`;
        
        const statusEl = document.getElementById('hub-quick-status');
        statusEl.textContent = issue.status.toUpperCase();
        statusEl.className = `status-indicator status-${issue.status}`;

        // Banner Alert
        const banner = document.getElementById('hub-alert-banner');
        if (issue.priority_score >= 80 || issue.sla_breached) {
            banner.classList.remove('hidden');
            banner.className = `hub-banner banner-critical pulse-alert`;
            document.getElementById('hub-alert-text').textContent = issue.sla_breached ? '🚨 SLA BREACH: IMMEDIATE ACTION REQUIRED' : '🔥 CRITICAL PRIORITY: URBAN CENTER IMPACT';
        } else {
            banner.classList.add('hidden');
        }

        // Modules
        document.getElementById('hub-description').textContent = issue.description;
        document.getElementById('hub-category').textContent = issue.category;
        document.getElementById('hub-subcategory').textContent = issue.subcategory || 'General';
        
        const scoreEl = document.getElementById('hub-priority-score');
        scoreEl.textContent = Math.round(issue.priority_score || 0);
        scoreEl.style.color = issue.priority_score >= 80 ? '#ef4444' : issue.priority_score >= 55 ? '#f97316' : '#eab308';

        document.getElementById('hub-ai-risk').textContent = `${Math.round((issue.breach_risk || 0) * 100)}%`;
        
        // Geo
        document.getElementById('hub-address').textContent = issue.address || 'Address indexing in progress...';
        document.getElementById('hub-ward').textContent = issue.ward || 'N/A';
        document.getElementById('hub-district').textContent = issue.district || 'N/A';

        this._initMiniMap(issue.latitude, issue.longitude);

        // Reporter
        document.getElementById('hub-reporter-name').textContent = issue.reporter_full_name || issue.reporter_name || 'Citizen';

        // Evidence
        const gallery = document.getElementById('hub-evidence-gallery');
        if (issue.image_url) {
            gallery.innerHTML = `
                <div class="evidence-item" onclick="ResolutionHub.zoomEvidence('${issue.image_url}')">
                    <img src="${issue.image_url}" alt="Evidence" loading="lazy">
                    <div class="evidence-overlay">🔎 VIEW FULL</div>
                </div>
            `;
        } else {
            gallery.innerHTML = `<div class="no-evidence">No visual evidence attached to this node.</div>`;
        }

        // Timeline
        const timeline = document.getElementById('hub-timeline');
        if (!history || history.length === 0) {
            timeline.innerHTML = `<div class="timeline-empty">System initialised. No historical shifts detected.</div>`;
        } else {
            timeline.innerHTML = history.map(h => `
                <div class="timeline-node">
                    <div class="node-time">${new Date(h.created_at).toLocaleString()}</div>
                    <div class="node-title">${h.action_type.replace(/_/g, ' ').toUpperCase()}</div>
                    <div class="node-meta">ACTOR: ${h.actor_role?.toUpperCase() || 'SYSTEM'} ${h.actor_name ? `(${h.actor_name})` : ''}</div>
                    ${h.note ? `<div class="node-note">${h.note}</div>` : ''}
                </div>
            `).join('');
        }

        // Populate Decision Engine fields
        if (user.role === 'admin' || user.role === 'authority') {
            document.getElementById('h-update-status').value = issue.status;
            document.getElementById('h-update-urgency').value = issue.urgency || 3;
            document.getElementById('h-update-impact').value = issue.impact_scale || 1;
            document.getElementById('h-update-assigned').value = issue.assigned_authority_id || '';
            document.getElementById('h-update-note').value = '';
        }
    },

    _enableActions(user) {
        const engine = document.getElementById('hub-decision-engine');
        if (user.role === 'admin' || user.role === 'authority') {
            engine.classList.remove('hidden');
        } else {
            engine.classList.add('hidden');
        }
    },

    _startLiveEngines(issue) {
        if (this._updateInterval) clearInterval(this._updateInterval);
        
        const timerEl = document.getElementById('hub-sla-timer');
        const barEl = document.getElementById('hub-sla-bar');
        const riskEl = document.getElementById('hub-sla-risk');
        const slaStatusEl = document.getElementById('hub-sla-status');

        const updateClock = () => {
            if (issue.status === 'resolved') {
                timerEl.textContent = 'COMPLETED';
                barEl.style.width = '100%';
                barEl.style.background = '#10b981';
                riskEl.textContent = 'STATUS: STABLE';
                slaStatusEl.textContent = 'RESOLVED';
                slaStatusEl.className = 'sla-status-badge status-resolved';
                return;
            }

            if (!issue.sla_due_at) {
                timerEl.textContent = 'NO SLA TARGET';
                return;
            }

            const now = new Date();
            const due = new Date(issue.sla_due_at);
            const diff = due - now;

            if (diff <= 0) {
                timerEl.textContent = 'BREACHED';
                barEl.style.width = '100%';
                barEl.style.background = '#ef4444';
                riskEl.textContent = 'RISK: MAXIMUM';
                slaStatusEl.textContent = 'BREACHED';
                slaStatusEl.className = 'sla-status-badge status-breached';
            } else {
                const hours = Math.floor(diff / 3600000);
                const mins = Math.floor((diff % 3600000) / 60000);
                const secs = Math.floor((diff % 60000) / 1000);
                timerEl.textContent = `${hours}h ${mins}m ${secs}s`;
                
                // Calculate percentage
                const total = (issue.sla_hours || 48) * 3600000;
                const pct = Math.max(0, Math.min(100, (diff / total) * 100));
                barEl.style.width = `${100 - pct}%`;
                
                if (pct < 20) {
                    barEl.style.background = '#ef4444';
                    riskEl.textContent = 'RISK: CRITICAL';
                } else if (pct < 50) {
                    barEl.style.background = '#f97316';
                    riskEl.textContent = 'RISK: ELEVATED';
                } else {
                    barEl.style.background = '#6366f1';
                    riskEl.textContent = 'RISK: LOW';
                }

                slaStatusEl.textContent = 'ACTIVE';
                slaStatusEl.className = 'sla-status-badge status-active';
            }
        };

        updateClock();
        this._updateInterval = setInterval(updateClock, 1000);
    },

    async commitUpdate() {
        const id = this.selectedIssueId;
        const btn = document.getElementById('hub-btn-save');
        const originalText = btn.textContent;
        
        const payload = {
            status: document.getElementById('h-update-status').value,
            urgency: parseInt(document.getElementById('h-update-urgency').value),
            impact_scale: parseInt(document.getElementById('h-update-impact').value),
            assigned_authority_id: document.getElementById('h-update-assigned').value || null,
            resolution_note: document.getElementById('h-update-note').value
        };

        if (payload.status === 'resolved' && !payload.resolution_note) {
            showToast('Resolution audit required for "RESOLVED" status.', 'error');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'EXECUTING TRANSACTION...';

        try {
            await API.patch(`/api/issues/${id}`, payload);
            showToast('Operational State Successfully Persisted', 'success');
            
            // Re-fetch and sync
            await this._loadIssuePipeline(id);

            // Cross-component Sync
            if (typeof loadIssues === 'function') loadIssues();
            if (typeof fetchIssues === 'function') fetchIssues();
            if (typeof loadEscalations === 'function') loadEscalations();
            
            if (window.MapManager) {
                const issues = await API.getIssues();
                window.MapManager.updateData(issues, typeof Auth !== 'undefined' ? Auth.getUser()?.role : 'citizen');
            }

        } catch (err) {
            console.error(err);
            showToast(`Transaction Failure: ${err.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    },

    close() {
        const drawer = document.getElementById('resolution-hub-drawer');
        if (drawer) drawer.classList.remove('active');
        this.isOpen = false;
        this.selectedIssueId = null;
        if (this._updateInterval) clearInterval(this._updateInterval);

        // Clear URL selection
        const url = new URL(window.location);
        url.searchParams.delete('selected');
        window.history.pushState({}, '', url);
    },

    copyId() {
        if (!this.selectedIssueId) return;
        navigator.clipboard.writeText(this.selectedIssueId);
        showToast('ID Copied to Clipboard', 'success');
    },

    zoomEvidence(url) {
        // Simple modal zoom
        const modal = document.createElement('div');
        modal.className = 'evidence-modal';
        modal.onclick = () => modal.remove();
        modal.innerHTML = `<img src="${url}">`;
        document.body.appendChild(modal);
    },

    viewReporterProfile() {
        showToast('Elite Reporter Profile coming soon', 'info');
    },

    _initMiniMap(lat, lng) {
        const container = document.getElementById('hub-map-container');
        if (!lat || !lng) {
            container.innerHTML = '<div class="no-map">Spatial coordinates unavailable.</div>';
            return;
        }
        
        container.innerHTML = '';
        const mapEl = document.createElement('div');
        mapEl.style.width = '100%';
        mapEl.style.height = '100%';
        container.appendChild(mapEl);

        setTimeout(() => {
            if (typeof L === 'undefined') return;
            const map = L.map(mapEl, {
                zoomControl: false,
                attributionControl: false,
                dragging: false,
                scrollWheelZoom: false,
                doubleClickZoom: false
            }).setView([lat, lng], 15);

            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
            L.circleMarker([lat, lng], {
                radius: 8,
                color: '#6366f1',
                fillColor: '#6366f1',
                fillOpacity: 1
            }).addTo(map);
        }, 100);
    },

    _handleUrlSelection() {
        const urlParams = new URLSearchParams(window.location.search);
        const selectedId = urlParams.get('selected');
        if (selectedId && selectedId !== this.selectedIssueId) {
            this._loadIssuePipeline(selectedId);
        } else if (!selectedId && this.isOpen) {
            this.close();
        }
    },

    _setLoadingState(loading) {
        const body = document.querySelector('.hub-body');
        if (!body) return;
        if (loading) {
            body.style.opacity = '0.4';
            body.style.pointerEvents = 'none';
        } else {
            body.style.opacity = '1';
            body.style.pointerEvents = 'auto';
        }
    },

    _injectStyles() {
        if (document.getElementById('hub-engine-styles')) return;
        const style = document.createElement('style');
        style.id = 'hub-engine-styles';
        style.textContent = `
            .resolution-hub { position: fixed; inset: 0; z-index: 10000; visibility: hidden; pointer-events: none; }
            .resolution-hub.active { visibility: visible; pointer-events: auto; }
            
            .hub-overlay { position: absolute; inset: 0; background: rgba(2,6,23,0.8); backdrop-filter: blur(12px); opacity: 0; transition: opacity 0.5s; }
            .resolution-hub.active .hub-overlay { opacity: 1; }
            
            .hub-container { 
                position: absolute; right: 0; top: 0; bottom: 0; width: 480px; 
                background: #020617; border-left: 1px solid rgba(99,102,241,0.2);
                transform: translateX(100%); transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
                display: flex; flex-direction: column; overflow: hidden;
                box-shadow: -30px 0 80px rgba(0,0,0,0.8);
            }
            .resolution-hub.active .hub-container { transform: translateX(0); }
            @media (max-width: 500px) { .hub-container { width: 100%; } }

            .hub-header { padding: 32px 24px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: flex-start; }
            .header-main { display: flex; gap: 16px; align-items: center; }
            .hub-identity-icon { width: 48px; height: 48px; background: rgba(99,102,241,0.1); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; border: 1px solid rgba(99,102,241,0.2); }
            .header-titles h2 { margin: 0; font-size: 1.35rem; font-weight: 900; color: white; letter-spacing: -0.02em; }
            .header-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
            #hub-tracking-id { font-size: 0.72rem; color: #94a3b8; font-weight: 800; font-family: 'JetBrains Mono', monospace; }
            .meta-sep { color: rgba(255,255,255,0.1); font-size: 0.7rem; }
            .status-indicator { font-size: 0.65rem; font-weight: 900; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.5px; }
            .status-reported { background: rgba(99,102,241,0.15); color: #818cf8; }
            .status-resolved { background: rgba(16,185,129,0.15); color: #10b981; }
            .status-escalated { background: rgba(239,68,68,0.15); color: #ef4444; }
            .status-in_progress { background: rgba(245,158,11,0.15); color: #f59e0b; }
            
            .btn-copy-id { background: transparent; border: none; color: #64748b; cursor: pointer; font-size: 0.8rem; padding: 2px; }
            .hub-close { background: none; border: none; font-size: 2.5rem; color: #475569; cursor: pointer; line-height: 0.5; transition: color 0.3s; }
            .hub-close:hover { color: white; }

            .hub-body { flex: 1; padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 32px; }
            .hub-module label { display: block; font-size: 0.65rem; font-weight: 900; color: #475569; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 12px; }
            
            .hub-banner { padding: 12px 16px; border-radius: 12px; font-weight: 800; font-size: 0.75rem; text-align: center; margin-bottom: -8px; }
            .banner-critical { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
            
            .sla-module { background: rgba(255,255,255,0.02); padding: 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); }
            .sla-progress-wrap { height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; margin-bottom: 12px; }
            .sla-bar-fill { height: 100%; width: 0%; transition: width 1s linear, background 0.5s auto; }
            .sla-footer { display: flex; justify-content: space-between; align-items: center; }
            .sla-timer-text { font-family: 'JetBrains Mono', monospace; font-size: 1.1rem; font-weight: 900; color: white; }
            .sla-risk-label { font-size: 0.65rem; font-weight: 800; color: #94a3b8; }
            .sla-status-badge { font-size: 0.6rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; }
            
            .hub-mini-map { height: 160px; border-radius: 14px; background: #0f172a; margin-bottom: 16px; border: 1px solid rgba(255,255,255,0.05); overflow: hidden; }
            .geo-meta { display: flex; flex-direction: column; gap: 12px; }
            .geo-item { display: flex; flex-direction: column; gap: 4px; }
            .geo-label { font-size: 0.6rem; font-weight: 800; color: #64748b; }
            .geo-val { font-size: 0.85rem; color: #e2e8f0; font-weight: 600; }
            .geo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

            .issue-desc { font-size: 0.95rem; line-height: 1.7; color: #cbd5e1; margin: 0; }
            .context-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-top: 24px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.05); }
            .val-bold { font-size: 0.95rem; font-weight: 800; color: white; }
            .val-score { font-size: 1.8rem; font-weight: 900; color: var(--accent); }

            .reporter-card { display: flex; align-items: center; gap: 16px; background: rgba(255,255,255,0.03); padding: 16px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.05); }
            .reporter-avatar { width: 44px; height: 44px; background: #1e293b; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; }
            .reporter-name { font-weight: 800; color: white; margin-bottom: 4px; }
            .trust-score { font-size: 0.65rem; font-weight: 900; color: #10b981; background: rgba(16,185,129,0.1); padding: 2px 6px; border-radius: 4px; }

            .evidence-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
            .evidence-item { position: relative; border-radius: 10px; overflow: hidden; aspect-ratio: 1; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); }
            .evidence-item img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s; }
            .evidence-item:hover img { transform: scale(1.1); }
            .evidence-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.4); opacity: 0; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.65rem; font-weight: 900; transition: opacity 0.3s; }
            .evidence-item:hover .evidence-overlay { opacity: 1; }
            .no-evidence { font-size: 0.75rem; color: #475569; font-style: italic; }

            .hub-timeline-v3 { padding-left: 20px; border-left: 1px solid rgba(255,255,255,0.05); }
            .timeline-node { position: relative; margin-bottom: 32px; }
            .timeline-node::before { content: ''; position: absolute; left: -25.5px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: #6366f1; border: 2px solid #020617; }
            .node-time { font-size: 0.65rem; color: #64748b; margin-bottom: 4px; font-weight: 700; }
            .node-title { font-size: 0.85rem; font-weight: 800; color: white; margin-bottom: 2px; }
            .node-meta { font-size: 0.7rem; color: #6366f1; font-weight: 700; }
            .node-note { margin-top: 8px; font-size: 0.75rem; color: #94a3b8; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px; line-height: 1.6; }

            .decision-module { background: rgba(99,102,241,0.05); padding: 24px; border-radius: 20px; border: 1px solid rgba(99,102,241,0.15); margin-top: 10px; }
            .decision-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
            .form-group.full { grid-column: span 2; }
            .hub-select, .hub-input, .hub-textarea { width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 12px; color: white; font-size: 0.9rem; }
            .hub-textarea { height: 100px; resize: none; }
            .hub-btn-primary { grid-column: span 2; background: #6366f1; color: white; border: none; padding: 16px; border-radius: 12px; font-weight: 900; letter-spacing: 1px; cursor: pointer; transition: all 0.3s; margin-top: 8px; }
            .hub-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(99,102,241,0.4); }
            .auth-tag { font-size: 0.6rem; font-weight: 900; color: #d97706; background: rgba(217,119,6,0.1); padding: 2px 6px; border-radius: 4px; }

            .evidence-modal { position: fixed; inset: 0; z-index: 10001; background: rgba(0,0,0,0.95); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 40px; }
            .evidence-modal img { max-width: 100%; max-height: 100%; object-fit: contain; }

            .pulse-alert { animation: bannerPulse 1.5s infinite; }
            @keyframes bannerPulse { 
                0% { opacity: 0.8; } 50% { opacity: 1; background: #ef4444; color: white; } 100% { opacity: 0.8; }
            }

            .hidden { display: none !important; }
            .custom-scrollbar::-webkit-scrollbar { width: 4px; }
            .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        `;
        document.head.appendChild(style);
    }
};

// Maintain compatibility
window.DetailManager = ResolutionHub;
window.ResolutionHub = ResolutionHub;
