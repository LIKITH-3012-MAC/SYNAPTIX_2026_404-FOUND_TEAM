/**
 * RESOLVIT - Profile & Unified Identity Intelligence
 * Handles cross-role profile rendering, civic stats, and audit logs.
 */
const ProfileManager = {
    user: null,
    stats: {},
    badges: [],

    async init() {
        console.log("[Profile] Initializing Identity Dashboard...");
        
        // 1. Wait for Auth0 session check if available
        if (typeof Auth0Integration !== 'undefined') {
            await Auth0Integration.boot();
        }

        this.user = Auth.getUser();
        console.log("[Profile] Current User:", this.user);
        if (!this.user) {
            console.warn("[Profile] No user session found. Redirecting to landing...");
            window.location.href = 'index.html';
            return;
        }

        // Set role data attribute for CSS
        document.body.dataset.role = this.user.role || 'citizen';

        // Initial render with cached data
        console.log("[Profile] Rendering Sidebar...");
        this.renderIdentitySidebar(this.user);
        console.log("[Profile] Rendering Content Area (Initial)...");
        this.renderContentArea(this.user);
        
        // Fetch fresh data
        console.log("[Profile] Fetching Fresh Data...");
        await this.fetchFreshData();
    },

    async fetchFreshData() {
        try {
            console.log("[Profile] Starting Fetch...");
            // 1. Fetch Unified Profile Intelligence
            const profileData = await API.get(`/api/user/profile`);
            console.log("[Profile] Profile Data Received:", profileData);
            
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
                full_name: this.user.full_name || this.user.name,
                picture: this.user.profile_picture || this.user.picture,
                profile_picture: this.user.profile_picture || this.user.picture
            }));

            // 3. Fetch Role-Specific Detailed Data
            if (this.user.role === 'admin') {
                await this.loadAdminStats();
            } else if (this.user.role === 'authority') {
                await this.loadAuthorityStats();
            } else {
                // Fetch real citizen stats and issues
                console.log("[Profile] Loading Citizen Stats...");
                await this.loadCitizenStats();
                console.log("[Profile] Fetching My Issues...");
                this.user.myIssues = await API.get('/api/user/issues').catch(() => []);
                console.log("[Profile] Initializing Personal Map...");
                this.initPersonalMap(this.user.myIssues);
            }
            
            // 4. Update UI with fresh data
            console.log("[Profile] Updating UI...");
            this.renderIdentitySidebar(this.user);
            this.renderContentArea(this.user);
            this.clearLoadingPlaceholders();
            console.log("[Profile] Initialization Complete.");
        } catch (error) {
            console.error("[Profile] Identity Sync Failure:", error);
            // Even on failure, try to clear skeletons and show what we have
            this.clearLoadingPlaceholders();
            if (typeof showToast === 'function') {
                showToast("Failed to synchronise identity dossier.", "error");
            }
        }
    },

    clearLoadingPlaceholders() {
        console.log("[Profile] Clearing Placeholders...");
        // Remove ALL skeletons and opacity blocks
        [...document.querySelectorAll('.identity-card, .panel-premium, [style*="opacity: 0.5"]')]
            .forEach(el => {
                el.style.opacity = "1";
                el.classList.remove('loading', 'skeleton');
            });

        [...document.querySelectorAll('div, span')]
            .filter(el => 
                el.textContent.includes('Decrypting Identity') || 
                el.textContent.includes('Processing identity history') ||
                el.textContent.includes('Contribution Statistics') && el.parentElement.classList.contains('panel-premium')
            ).forEach(el => {
                // If it's a "Decrypting Identity" text node, remove it
                if (el.textContent.includes('Decrypting Identity')) el.remove();
            });
            
        console.log("[Profile] Placeholders Cleared.");
    },

    /**
     * Renders the Identity Sidebar with profile info and auth source.
     */
    renderIdentitySidebar(user) {
        const sidebar = document.getElementById('identity-sidebar');
        if (!sidebar) return;

        const profilePic = user.profile_picture || user.picture || 'assets/default-avatar.png';
        const isGoogle = user.auth_provider === 'google' || user.email?.includes('gmail.com');

        sidebar.innerHTML = `
            <div class="identity-card">
                <div class="profile-avatar-wrapper">
                    <div class="hero-avatar-ring">
                        <div class="hero-avatar-inner">
                            <img src="${profilePic}" alt="Identity">
                        </div>
                    </div>
                    ${isGoogle ? '<div class="provider-badge"><img src="https://www.google.com/favicon.ico" alt="Google"></div>' : ''}
                </div>
                
                <h2 class="identity-name">${user.full_name || user.username || 'CITIZEN'}</h2>
                <p class="identity-email">${user.email}</p>
                
                <div class="role-badge-chip">
                    <span>${user.role === 'authority' ? '🏛️ AUTHORITY' : user.role === 'admin' ? '⭐ ADMIN' : '👤 CITIZEN'}</span>
                </div>

                <div class="identity-meta">
                    <div class="meta-item">
                        <span class="meta-label">Account ID</span>
                        <span class="meta-value">${user.id.substring(0, 12)}…</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Status</span>
                        <span class="meta-value" style="color:#10b981;">✅ Active / Verified</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Joined Sector</span>
                        <span class="meta-value">${this.formatDate(user.created_at || new Date().toISOString())}</span>
                    </div>
                </div>

                <div class="security-visual-box" style="margin-top:20px; text-align:left;">
                    <div class="secure-badge">
                        <span class="secure-icon">🛡️</span>
                        <span>Dossier Encrypted</span>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Renders the main command center area.
     */
    renderContentArea(user) {
        console.log("[Profile] Rendering Command Center for:", user.role);
        
        // Populate Hero Section
        this.renderHeroSection(user);
        
        // Populate Power Stats
        this.renderPowerStats(user);
        
        // Populate History Section
        this.renderHistorySection(user);

        // Populate Analytics Panel
        this.renderAnalyticsPanel(user);
    },

    renderHeroSection(user) {
        const container = document.getElementById('profile-hero-section');
        if (!container) return;

        const stats = user.stats || { total_points: 0 };
        const rank = user.role === 'admin' ? 'System Architect' : user.role === 'authority' ? 'Sector Commander' : 'Prime Citizen';

        container.innerHTML = `
            <div class="profile-hero-card">
                <div class="hero-info-glow">
                    <div style="font-size:0.8rem; color:var(--accent); text-transform:uppercase; letter-spacing:3px; margin-bottom:8px;">Identity Dossier</div>
                    <h2>Welcome, ${user.full_name?.split(' ')[0] || user.username}</h2>
                    <p style="color:var(--text-muted); font-size:1.1rem; margin-top:8px;">Designated Rank: <span style="color:white; font-weight:700;">${rank}</span></p>
                </div>
                <div style="margin-left:auto; text-align:right;">
                    <div style="font-size:0.7rem; color:var(--text-muted);">CURRENT IMPACT SCORE</div>
                    <div style="font-size:3rem; font-weight:900; color:var(--accent); line-height:1;">${stats.total_points || 0}</div>
                </div>
            </div>
        `;
    },

    renderPowerStats(user) {
        const container = document.getElementById('profile-stats-section');
        if (!container) return;

        const stats = user.stats || { total_points: 0, issues_count: 0, rank: '?' };
        const myIssues = user.myIssues || [];
        
        const solvedCount = myIssues.filter(i => i.status === 'resolved').length;
        const activeCount = myIssues.filter(i => i.status !== 'resolved').length;

        container.innerHTML = `
            <div class="power-stat-grid">
                <div class="power-stat-card">
                    <div class="stat-icon-wrapper" style="color:#00CFFF;">🚩</div>
                    <div class="stat-main-info">
                        <span class="stat-value-elite" data-target="${stats.issues_count || 0}">0</span>
                        <span class="stat-label-elite">Reports Filed</span>
                    </div>
                </div>
                <div class="power-stat-card">
                    <div class="stat-icon-wrapper" style="color:#10b981;">✅</div>
                    <div class="stat-main-info">
                        <span class="stat-value-elite" data-target="${solvedCount}">0</span>
                        <span class="stat-label-elite">Resolved</span>
                    </div>
                </div>
                <div class="power-stat-card">
                    <div class="stat-icon-wrapper" style="color:#f97316;">⚡</div>
                    <div class="stat-main-info">
                        <span class="stat-value-elite" data-target="${activeCount}">0</span>
                        <span class="stat-label-elite">Active Ops</span>
                    </div>
                </div>
                <div class="power-stat-card">
                    <div class="stat-icon-wrapper" style="color:#FACC15;">🏆</div>
                    <div class="stat-main-info">
                        <span class="stat-value-elite" data-target="${stats.total_points || 0}">0</span>
                        <span class="stat-label-elite">Civic Credits</span>
                    </div>
                </div>
            </div>
        `;

        // Trigger count-up animation
        setTimeout(() => this.animateStats(), 100);
    },

    animateStats() {
        document.querySelectorAll('.stat-value-elite').forEach(el => {
            const target = parseInt(el.dataset.target);
            this.countUp(el, target, 1500);
        });
    },

    countUp(element, target, duration) {
        let start = 0;
        const increment = target / (duration / 16);
        const timer = setInterval(() => {
            start += increment;
            if (start >= target) {
                element.textContent = target;
                clearInterval(timer);
            } else {
                element.textContent = Math.floor(start);
            }
        }, 16);
    },

    renderHistorySection(user) {
        const container = document.getElementById('profile-history-section');
        if (!container) return;

        container.innerHTML = `
            <div class="profile-section">
                <div class="section-header-row">
                    <h3 class="section-title">📜 Operational History</h3>
                    <button class="view-all-btn" onclick="window.location.href='dashboard.html'">Full Intel Dashboard</button>
                </div>
                <div id="issues-list-container" class="issue-timeline-premium">
                    <div class="ledger-loading">Accessing classified reports...</div>
                </div>
            </div>
        `;

        this.renderMyIssues(user.myIssues);
    },

    renderMyIssues(issues) {
        const container = document.getElementById('issues-list-container');
        if (!container) return;

        if (!issues || issues.length === 0) {
            container.innerHTML = `
                <div class="empty-state-premium">
                    <div class="empty-icon">📁</div>
                    <p>No active operations found in your dossier.</p>
                    <button class="btn-sm btn-primary" onclick="window.location.href='submit.html'" style="margin-top:10px;">Initiate Report</button>
                </div>
            `;
            return;
        }

        container.innerHTML = issues.slice(0, 5).map(issue => `
            <div class="timeline-card" onclick="window.location.href='issue.html?id=${issue.id}'">
                <div class="issue-main-info">
                    <div class="issue-title-row">
                        <span class="issue-id">#${issue.tracking_id || issue.id.substring(0,8)}</span>
                        <h4 class="issue-title-text" style="margin:0;">${issue.title}</h4>
                    </div>
                    <div class="issue-meta-row" style="margin-top:8px;">
                        <span class="issue-category" style="color:var(--accent);">${issue.category}</span>
                        <span>•</span>
                        <span class="issue-date">${this.formatDate(issue.created_at)}</span>
                    </div>
                </div>
                <div style="text-align:right;">
                    <div class="issue-status-badge status-${issue.status.toLowerCase()}">${issue.status.replace('_', ' ')}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted); margin-top:8px; cursor:pointer;">View Full Intel →</div>
                </div>
            </div>
        `).join('');
    },

    renderAnalyticsPanel(user) {
        const trustVal = document.getElementById('trust-score-value');
        if (trustVal) {
            const score = user.stats?.total_points > 500 ? 98 : user.stats?.total_points > 100 ? 85 : 72;
            this.countUp(trustVal, score, 2000);
        }

        const miniStats = document.getElementById('analytics-mini-stats');
        if (miniStats) {
            miniStats.innerHTML = `
                <div class="mini-stat-card">
                    <span class="mini-stat-val">${user.stats?.rank || '#1'}</span>
                    <span class="mini-stat-lbl">Global Rank</span>
                </div>
                <div class="mini-stat-card">
                    <span class="mini-stat-val">100%</span>
                    <span class="mini-stat-lbl">Auth Strength</span>
                </div>
            `;
        }
    },

    async loadActivityLedger(userId) {
        // Obsolete in new layout but kept for compatibility if needed elsewhere
    },

    formatDate(dateStr) {
        if (!dateStr) return 'Unknown Date';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    },

    renderAdminDashboard(user, container) { this.renderContentArea(user); },
    renderAuthorityDashboard(user, container) { this.renderContentArea(user); },

    // Helper stubs for fetching actual backend metrics
    async loadCitizenStats() {
        try {
            const credits = await API.get("/api/credits/me").catch(() => ({}));
            const issues = await API.get("/api/issues").catch(() => []);
            const myIssues = issues.filter(i => i.reporter_id === this.user.id || i.reporter_name === this.user.username);
            this.user.myIssues = myIssues;
            this.user.stats = {
                total_points: credits.total_points || 0,
                rank: credits.rank || '#1',
                issues_count: myIssues.length
            };
        } catch (err) {
            console.error("[Profile] Failed to load citizen stats:", err);
        }
    },

    initPersonalMap(myIssues) {
        // Removed from main view as per elite design, but could be added back to analytics
    },

    async loadAdminStats() { this.user.stats = { total_monitored: 'All Sectors' }; },
    async loadAuthorityStats() {
        try {
            const issues = await API.get("/api/issues").catch(() => []);
            const myIssues = issues.filter(i => i.department === this.user.department);
            this.user.stats = {
                pending_count: myIssues.filter(i => i.status !== 'resolved').length,
                resolved_count: myIssues.filter(i => i.status === 'resolved').length,
                sla_performance: '96.4%'
            };
        } catch (err) {
            console.error("[Profile] Failed to load authority stats:", err);
        }
    }
};

window.ProfileManager = ProfileManager;
document.addEventListener('DOMContentLoaded', () => ProfileManager.init());
