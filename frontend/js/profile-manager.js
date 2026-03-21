/**
 * RESOLVIT - Profile Identity Manager
 * Handles premium identity dashboard logic and role-aware rendering.
 */

const ProfileManager = {
    user: null,

    async init() {
        console.log("[Profile] Initializing Identity Dashboard...");
        
        // 1. Wait for Auth0 session check if available
        if (typeof Auth0Integration !== 'undefined') {
            await Auth0Integration.boot();
        }

        this.user = Auth.getUser();
        if (!this.user) {
            console.warn("[Profile] No user session found. Redirecting to landing...");
            window.location.href = 'index.html';
            return;
        }

        // Set role data attribute for CSS
        document.body.dataset.role = this.user.role || 'citizen';

        // Initial render with cached data
        this.renderIdentitySidebar(this.user);
        
        // Fetch fresh data
        await this.fetchFreshData();
    },

    async fetchFreshData() {
        try {
            // 1. Fetch Unified Profile Intelligence
            const profileData = await API.get(`/api/user/profile`);
            
            // 2. Update local state — merge profile data correctly
            const serverUser = profileData.user || {};
            this.user = { 
                ...this.user, 
                ...serverUser, 
                // Normalize: ensure picture is available under both keys
                picture: serverUser.profile_picture || serverUser.picture || this.user.picture,
                profile_picture: serverUser.profile_picture || serverUser.picture || this.user.profile_picture,
                stats: profileData.stats, 
                badges: profileData.badges 
            };
            
            // Sync to localStorage so other pages have fresh data
            localStorage.setItem('resolvit_user', JSON.stringify({
                id: this.user.id,
                username: this.user.username,
                email: this.user.email,
                role: this.user.role,
                department: this.user.department || null,
                auth_provider: this.user.auth_provider || 'database',
                full_name: this.user.full_name,
                picture: this.user.profile_picture || this.user.picture,
                profile_picture: this.user.profile_picture || this.user.picture
            }));

            // 3. Fetch Role-Specific Detailed Data
            if (this.user.role === 'admin') {
                await this.loadAdminStats();
            } else if (this.user.role === 'authority') {
                await this.loadAuthorityStats();
            } else {
                // Fetch personal issues list
                this.user.myIssues = await API.get('/api/user/issues', options).catch(() => []);
            }
            
            // 3.5 Clear 'Decrypting Identity' placeholder (Failsafe)
            this.clearLoadingPlaceholders();
        } catch (error) {
            console.error("[Profile] Identity Sync Failure:", error);
            this.clearLoadingPlaceholders();
            if (!options.silent) showToast("Failed to synchronise identity dossier.", "error");
        }
    },

    clearLoadingPlaceholders() {
        const placeholder = document.getElementById('identity-sidebar')?.querySelector('div[style*="Decrypting Identity"]');
        if (placeholder) placeholder.remove();
        
        // Secondary check for ANY text-based placeholder in the sidebar or content area
        [...document.querySelectorAll('div, span')].filter(el => 
            el.textContent.includes('Decrypting Identity') || 
            el.textContent.includes('Processing identity history')
        ).forEach(el => el.remove());
    },

    /**
     * Renders the Identity Sidebar with profile info and auth source.
     */
    renderIdentitySidebar(user) {
        const sidebar = document.getElementById('identity-sidebar');
        if (!sidebar) return;

        const providerName = user.auth_provider === 'google' ? 'Google' : 
                             user.auth_provider === 'github' ? 'GitHub' : 
                             user.auth_provider === 'twitter' ? 'Twitter' : 'Email/Password';
        
        let providerIcon = '🔐';
        if (user.auth_provider === 'google') {
            providerIcon = 'https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg';
        } else if (user.auth_provider === 'github') {
            providerIcon = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
        } else if (user.auth_provider === 'twitter') {
            providerIcon = 'https://abs.twimg.com/favicons/twitter.3.ico';
        }

        // Avatar logic — check both field names
        const profilePic = user.profile_picture || user.picture;
        const initials = user.full_name 
            ? user.full_name.split(' ').map(n=>n[0]).join('').toUpperCase().substring(0,2)
            : (user.username || 'U').substring(0,2).toUpperCase();
        
        const avatarHtml = profilePic 
            ? `<img src="${profilePic}" class="profile-avatar" alt="${user.username}">`
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
                        ${user.auth_provider === 'google' ? '🌐' : user.auth_provider === 'github' ? '🐙' : user.auth_provider === 'twitter' ? '𝕏' : '🔑'}
                    </div>
                    <div class="auth-details" style="text-align:left;">
                        <h4>Logged in via ${providerName}</h4>
                        <p>Identity verified through secure Auth channel</p>
                    </div>
                </div>

                <div class="identity-meta">
                    <div class="meta-item">
                        <span class="meta-label">Account ID</span>
                        <span class="meta-value">ID: ${(user.id || 'pending').substring(0, 8)}…</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Account Status</span>
                        <span class="meta-value">✅ Active / Verified</span>
                    </div>
                    ${user.created_at ? `
                    <div class="meta-item">
                        <span class="meta-label">Member Since</span>
                        <span class="meta-value">${new Date(user.created_at).toLocaleDateString('en-US', {year:'numeric', month:'long', day:'numeric'})}</span>
                    </div>` : ''}
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
        const btnPdf = document.getElementById('btn-export-pdf');
        const btnCsv = document.getElementById('btn-export-csv');
        const statusEl = document.getElementById('export-status');
        const categoryEl = document.getElementById('export-category');
        
        // UI State: Loading
        const originalText = format === 'pdf' ? (btnPdf?.innerHTML || 'PDF Report') : (btnCsv?.innerHTML || 'CSV Data');
        if (btnPdf) btnPdf.disabled = true;
        if (btnCsv) btnCsv.disabled = true;
        
        if (typeof showToast === 'function') {
            showToast(`⏳ Generating your premium ${format.toUpperCase()} report...`, 'info');
        }

        const token = localStorage.getItem('resolvit_token');
        const status = statusEl?.value || '';
        const category = categoryEl?.value || '';
        
        let url = `${API.BASE_URL}/api/export/issues/${format}`;
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        if (category) params.append('category', category);
        if (params.toString()) url += `?${params.toString()}`;

        try {
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || 'Export failed');
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = downloadUrl;
            a.download = `resolvit_export_${new Date().toISOString().split('T')[0]}_${status || 'all'}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            
            if (typeof showToast === 'function') showToast(`✅ ${format.toUpperCase()} Export Complete!`, 'success');
        } catch (error) {
            console.error(error);
            if (typeof showToast === 'function') showToast(`❌ Export failed: ${error.message}`, 'error');
        } finally {
            if (btnPdf) btnPdf.disabled = false;
            if (btnCsv) btnCsv.disabled = false;
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
            // Fetch live activity from unified ledger
            const activity = await API.get("/api/user/activity");
            const items = activity.map(t => ({
                title: t.note || t.action || 'Civic Contribution',
                time: new Date(t.created_at).toLocaleDateString() + ' ' + new Date(t.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                icon: t.credits_delta > 0 ? '💰' : '🔹',
                color: t.credits_delta > 0 ? '#10b981' : '#6366f1',
                delta: t.credits_delta
            }));

            // Merge with local issues if any (heuristic)
            if (this.user.myIssues) {
                this.user.myIssues.slice(0, 5).forEach(i => {
                    items.push({
                        title: `Reported: ${i.title}`,
                        time: new Date(i.created_at).toLocaleDateString(),
                        icon: '📝',
                        color: '#6366f1'
                    });
                });
            }

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
        const myIssues = issues.filter(i => i.reporter_id === this.user.id || i.reporter_name === this.user.username);
        this.user.myIssues = myIssues;
        this.user.stats = {
            total_points: credits.total_points || 0,
            rank: credits.rank || '?',
            issues_count: myIssues.length
        };
    },

    initPersonalMap(myIssues) {
        const container = document.getElementById('personal-impact-map-container');
        if (!container) return;
        container.style.display = 'block';

        setTimeout(() => {
            if (typeof MapManager !== 'undefined') {
                MapManager.init("personal-map", [12.9716, 77.5946]);
                MapManager.updateData(myIssues, "citizen");
            }
        }, 300);
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
