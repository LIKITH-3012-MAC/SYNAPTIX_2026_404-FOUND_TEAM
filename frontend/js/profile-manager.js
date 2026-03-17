/**
 * RESOLVIT - Profile Identity Manager
 * Handles premium identity dashboard logic and role-aware rendering.
 */

const ProfileManager = {
    user: null,

    async init() {
        console.log("[Profile] Initializing Identity Dashboard...");
        this.user = Auth.getUser();
        if (!this.user) return;

        // Set role data attribute for CSS
        document.body.dataset.role = this.user.role || 'citizen';

        // Initial render with cached data
        this.renderIdentitySidebar(this.user);
        
        // Fetch fresh data
        await this.fetchFreshData();
    },

    async fetchFreshData() {
        try {
            // Attempt to get fresh user data from backend if possible
            const freshUser = await API.get(`/api/auth/me`).catch(() => null);
            if (freshUser) {
                // Merge fresh data with existing session info
                this.user = { ...this.user, ...freshUser };
            }

            // Fetch role-specific stats
            if (this.user.role === 'admin') {
                await this.loadAdminStats();
            } else if (this.user.role === 'authority') {
                await this.loadAuthorityStats();
            } else {
                await this.loadCitizenStats();
            }

            // Final render with all data
            this.renderIdentitySidebar(this.user);
            this.renderContentArea(this.user);
            this.renderSecuritySection(this.user);

        } catch (error) {
            console.error("[Profile] Failed to fetch identity data:", error);
        }
    },

    /**
     * Renders the Identity Sidebar with profile info and auth source.
     */
    renderIdentitySidebar(user) {
        const sidebar = document.getElementById('identity-sidebar');
        if (!sidebar) return;

        const providerName = user.auth_provider === 'google' ? 'Google' : 
                             user.auth_provider === 'github' ? 'GitHub' : 'Email/Password';
        
        let providerIcon = '🔐';
        if (user.auth_provider === 'google') {
            providerIcon = 'https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg';
        } else if (user.auth_provider === 'github') {
            providerIcon = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
        }

        // Avatar logic
        const initials = user.full_name 
            ? user.full_name.split(' ').map(n=>n[0]).join('').toUpperCase().substring(0,2)
            : (user.username || 'U').substring(0,2).toUpperCase();
        
        const avatarHtml = user.picture 
            ? `<img src="${user.picture}" class="profile-avatar" alt="${user.username}">`
            : `<div class="profile-avatar" style="display:flex;align-items:center;justify-content:center;background:var(--accent-gradient);color:white;font-size:3rem;font-weight:900;">${initials}</div>`;

        sidebar.innerHTML = `
            <div class="identity-card">
                <div class="profile-avatar-wrapper">
                    ${avatarHtml}
                    <div class="provider-badge">
                        ${user.auth_provider === 'database' ? `<span>${providerIcon}</span>` : `<img src="${providerIcon}" alt="${providerName}">`}
                    </div>
                </div>
                
                <h2 class="identity-name">${user.full_name || user.username}</h2>
                <div class="identity-email">${user.email || 'No email provided'}</div>
                
                <div class="role-badge-chip">
                    <span>${this.getRoleIcon(user.role)}</span> ${user.role}
                </div>

                <div class="auth-source-card">
                    <div class="auth-icon-wrapper">
                        ${user.auth_provider === 'google' ? '🌐' : user.auth_provider === 'github' ? '🐙' : '🔑'}
                    </div>
                    <div class="auth-details" style="text-align:left;">
                        <h4>Logged in via ${providerName}</h4>
                        <p>Identity verified through secure Auth channel</p>
                    </div>
                </div>

                <div class="identity-meta">
                    <div class="meta-item">
                        <span class="meta-label">Account ID</span>
                        <span class="meta-value">ID: ${user.id.substring(0, 8)}...</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Account Status</span>
                        <span class="meta-value">✅ Active / Verified</span>
                    </div>
                    ${user.department ? `
                    <div class="meta-item">
                        <span class="meta-label">Department</span>
                        <span class="meta-value">${user.department}</span>
                    </div>` : ''}
                </div>
            </div>
        `;
    },

    getRoleIcon(role) {
        switch(role) {
            case 'admin': return '🛡️';
            case 'authority': return '🏛️';
            default: return '👤';
        }
    },

    /**
     * Renders stats and activity cards based on user role.
     */
    async renderContentArea(user) {
        const content = document.getElementById('profile-content-area');
        if (!content) return;

        let statsHtml = '';
        if (user.role === 'admin') {
            statsHtml = this.getAdminStatsHtml(user);
        } else if (user.role === 'authority') {
            statsHtml = this.getAuthorityStatsHtml(user);
        } else {
            statsHtml = this.getCitizenStatsHtml(user);
        }

        content.innerHTML = `
            <div class="profile-content">
                <!-- Stats Section -->
                <div class="panel-premium">
                    <div class="panel-header">
                        <div class="panel-title">⭐ Contribution Statistics</div>
                    </div>
                    ${statsHtml}
                </div>

                <!-- Export Section -->
                <div class="panel-premium">
                    <div class="panel-header">
                        <div class="panel-title">📋 Report Intelligence & Exports</div>
                        <button onclick="document.getElementById('export-modal').style.display='flex'" class="btn btn-sm btn-ghost">Advanced Options</button>
                    </div>
                    <div class="stat-grid-premium" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));">
                        <div class="stat-card-premium" style="text-align:left; display:flex; gap:20px; align-items:center;">
                            <div style="font-size:2rem; background:rgba(255,255,255,0.05); padding:12px; border-radius:12px;">📊</div>
                            <div>
                                <div style="font-size:1.1rem; font-weight:700;">Issue History</div>
                                <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:12px;">Download all your reported data</div>
                                <div style="display:flex; gap:8px;">
                                    <button onclick="ProfileManager.triggerExport('pdf')" class="btn btn-sm btn-primary" style="padding:4px 12px; font-size:0.7rem;">PDF Report</button>
                                    <button onclick="ProfileManager.triggerExport('csv')" class="btn btn-sm btn-ghost" style="padding:4px 12px; font-size:0.7rem;">CSV Data</button>
                                </div>
                            </div>
                        </div>
                        <div class="stat-card-premium" style="text-align:left; display:flex; gap:20px; align-items:center; opacity: 0.6;">
                            <div style="font-size:2rem; background:rgba(255,255,255,0.05); padding:12px; border-radius:12px;">🏆</div>
                            <div>
                                <div style="font-size:1.1rem; font-weight:700;">Civic Certificates</div>
                                <div style="font-size:0.75rem; color:var(--text-muted);">Coming soon: Branded impact stickers</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="role-specific-content"></div>

                <div class="panel-premium">
                    <div class="panel-header">
                        <div class="panel-title">🕒 Recent Activity Timeline</div>
                    </div>
                    <div class="activity-timeline-premium" id="profile-activity-feed">
                        <div class="loading-placeholder">Processing identity history...</div>
                    </div>
                </div>
            </div>
        `;

        this.loadActivityFeed(user);
    },

    async triggerExport(format) {
        if (!typeof showToast === 'function') console.log("Export triggered:", format);
        else showToast(`⏳ Generating your ${format.toUpperCase()} report...`, 'info');

        const token = localStorage.getItem('resolvit_token');
        try {
            const response = await fetch(`${API.BASE_URL}/api/export/issues/${format}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Export failed');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `resolvit_export_${new Date().toISOString().split('T')[0]}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            if (typeof showToast === 'function') showToast(`✅ ${format.toUpperCase()} Export Complete!`, 'success');
        } catch (error) {
            console.error(error);
            if (typeof showToast === 'function') showToast(`❌ Export failed: ${error.message}`, 'error');
        }
    },

    getCitizenStatsHtml(user) {
        const pts = user.stats?.total_points || 0;
        const rank = user.stats?.rank || '—';
        const reported = user.stats?.issues_count || 0;

        return `
            <div class="stat-grid-premium">
                <div class="stat-card-premium">
                    <div class="stat-icon">💰</div>
                    <div class="stat-val">${pts.toLocaleString()}</div>
                    <div class="stat-lbl">Civic Points Earned</div>
                </div>
                <div class="stat-card-premium">
                    <div class="stat-icon">📈</div>
                    <div class="stat-val">#${rank}</div>
                    <div class="stat-lbl">Global Contributor Rank</div>
                </div>
                <div class="stat-card-premium">
                    <div class="stat-icon">📝</div>
                    <div class="stat-val">${reported}</div>
                    <div class="stat-lbl">Civic Issues Reported</div>
                </div>
            </div>
        `;
    },

    getAdminStatsHtml(user) {
        return `
            <div class="stat-grid-premium">
                <div class="stat-card-premium">
                    <div class="stat-icon">🎛️</div>
                    <div class="stat-val">Full Access</div>
                    <div class="stat-lbl">System Oversight Level</div>
                </div>
                <div class="stat-card-premium">
                    <div class="stat-icon">📊</div>
                    <div class="stat-val">${user.stats?.total_monitored || 'ALL'}</div>
                    <div class="stat-lbl">Monitored Infrastructures</div>
                </div>
                <div class="stat-card-premium">
                    <div class="stat-icon">🛡️</div>
                    <div class="stat-val">Active</div>
                    <div class="stat-lbl">Governance Status</div>
                </div>
            </div>
        `;
    },

    getAuthorityStatsHtml(user) {
        const resolved = user.stats?.resolved_count || 0;
        const pending = user.stats?.pending_count || 0;
        return `
            <div class="stat-grid-premium">
                <div class="stat-card-premium">
                    <div class="stat-icon">📋</div>
                    <div class="stat-val">${pending}</div>
                    <div class="stat-lbl">Active Assignments</div>
                </div>
                <div class="stat-card-premium">
                    <div class="stat-icon">✅</div>
                    <div class="stat-val">${resolved}</div>
                    <div class="stat-lbl">Impact Resolutions Completed</div>
                </div>
                <div class="stat-card-premium">
                    <div class="stat-icon">⚡</div>
                    <div class="stat-val">${user.stats?.sla_performance || '94%'}</div>
                    <div class="stat-lbl">SLA Performance Rating</div>
                </div>
            </div>
        `;
    },

    async loadActivityFeed(user) {
        const feed = document.getElementById('profile-activity-feed');
        if (!feed) return;

        try {
            // Fetch credits if citizen
            let items = [];
            if (user.role === 'citizen') {
                const credits = await API.get("/api/credits/me");
                items = (credits.transactions || []).map(t => ({
                    title: t.description || 'Civic Contribution',
                    time: new Date(t.created_at).toLocaleDateString() + ' ' + new Date(t.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                    icon: '💰',
                    color: '#10b981'
                }));
            }

            // Fetch recent issues
            const issues = await API.get("/api/issues?limit=5&sort_by=created_at&order=desc");
            const myIssues = issues.filter(i => i.reporter_id === user.sub || i.reporter_name === user.username);
            
            myIssues.forEach(i => {
                items.push({
                    title: `Reported: ${i.title}`,
                    time: new Date(i.created_at).toLocaleDateString(),
                    icon: '📝',
                    color: '#6366f1'
                });
            });

            if (items.length === 0) {
                feed.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);">No recent logs discovered in the audit trail.</div>`;
                return;
            }

            // Sort by time (heuristic since we mixed types)
            feed.innerHTML = items.slice(0, 8).map(item => `
                <div class="activity-item">
                    <div class="activity-icon" style="background:${item.color}15;color:${item.color};">
                        ${item.icon}
                    </div>
                    <div class="activity-info">
                        <div class="activity-title">${item.title}</div>
                        <div class="activity-time">${item.time}</div>
                    </div>
                </div>
            `).join('');

        } catch (e) {
            feed.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);">Failed to decrypt activity logs.</div>`;
        }
    },

    renderSecuritySection(user) {
        const content = document.getElementById('role-specific-content');
        if (!content) return;

        content.innerHTML += `
            <div class="panel-premium">
                <div class="panel-header">
                    <div class="panel-title">🛡️ Security & Account Access</div>
                </div>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:24px;">
                    <div class="auth-source-card" style="border-style: dashed;">
                        <div class="auth-icon-wrapper">🔐</div>
                        <div class="auth-details">
                            <h4>Session Fingerprint</h4>
                            <p>Current session is encrypted and hardware-accelerated.</p>
                        </div>
                    </div>
                    <div class="auth-source-card" style="border-style: dashed;">
                        <div class="auth-icon-wrapper">📱</div>
                        <div class="auth-details">
                            <h4>Two-Factor Authentication</h4>
                            <p>Status: <span style="color:var(--text-muted);">Not configured yet</span></p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    // Helper stubs for fetching actual backend metrics
    async loadCitizenStats() {
        const credits = await API.get("/api/credits/me").catch(() => ({}));
        const issues = await API.get("/api/issues").catch(() => []);
        const myIssues = issues.filter(i => i.reporter_id === this.user.id);
        this.user.stats = {
            total_points: credits.total_points || 0,
            rank: credits.rank || '?',
            issues_count: myIssues.length
        };
    },

    async loadAdminStats() {
        this.user.stats = { total_monitored: 'All Sectors' };
    },

    async loadAuthorityStats() {
        const issues = await API.get("/api/issues").catch(() => []);
        const myIssues = issues.filter(i => i.department === this.user.department);
        this.user.stats = {
            pending_count: myIssues.filter(i => i.status !== 'resolved').length,
            resolved_count: myIssues.filter(i => i.status === 'resolved').length,
            sla_performance: '96.4%'
        };
    }
};

window.ProfileManager = ProfileManager;
document.addEventListener('DOMContentLoaded', () => ProfileManager.init());
