/**
 * RESOLVIT CARE - Admin Command Logic
 * Manages NGO records, officer assignments, broadcasts, volunteers, and global care report oversight.
 */

window.CareAdmin = {
    async init() {
        await Promise.all([
            this.loadNGOs(),
            this.loadOfficers(),
            this.loadCareReports()
        ]);
        this.bindGlobalEvents();
    },

    bindGlobalEvents() {
        // Handle clicks on modals to close when clicking overlay
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('care-modal-overlay')) {
                this.hideModal();
            }
        });
    },

    hideModal() {
        const modal = document.getElementById('care-admin-modal');
        if (modal) modal.style.display = 'none';
    },

    showModal(title, html) {
        let modal = document.getElementById('care-admin-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'care-admin-modal';
            modal.className = 'modal-overlay care-modal-overlay';
            modal.innerHTML = `
                <div class="modal-box" style="max-width:550px; padding:32px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                        <h3 id="care-modal-title" style="margin:0; font-size:1.4rem;"></h3>
                        <button onclick="CareAdmin.hideModal()" style="background:none; border:none; color:#64748b; font-size:1.5rem; cursor:pointer;">✕</button>
                    </div>
                    <div id="care-modal-body"></div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        document.getElementById('care-modal-title').textContent = title;
        document.getElementById('care-modal-body').innerHTML = html;
        modal.style.display = 'flex';
    },

    // ═══════════════════════════════════════════════════════════
    // NGO MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    async loadNGOs() {
        try {
            const ngos = await API.get('/api/admin/ngos');
            this._cachedNGOs = ngos;
            const tbody = document.getElementById('ngo-tbody');
            if (!tbody) return;

            if (ngos.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#94a3b8;">No NGO records found.</td></tr>';
                return;
            }

            tbody.innerHTML = ngos.map(n => `
                <tr>
                    <td><strong>${n.name}</strong><br><small style="color:#64748b;">${n.slug}</small></td>
                    <td>${n.contact_name || '—'}<br><small style="color:#64748b;">${n.contact_email || ''}</small></td>
                    <td><span class="badge" style="background:rgba(99,102,241,0.1); color:#818cf8;">${n.specialization || 'General'}</span></td>
                    <td><span style="font-weight:700;">${n.officer_count || 0}</span></td>
                    <td>${n.is_active ? '✅ Active' : '🔴 Inactive'}</td>
                    <td>
                        <button class="btn btn-outline btn-sm" onclick="CareAdmin.openEditNGOModal('${n.id}')">Edit</button>
                    </td>
                </tr>
            `).join('');
        } catch (e) {
            console.error("NGO Load Fail:", e);
        }
    },

    async loadOfficers() {
        try {
            const officers = await API.get('/api/admin/ngo-officers');
            const tbody = document.getElementById('officer-tbody');
            if (!tbody) return;

            if (officers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:#94a3b8;">No officers recruited yet.</td></tr>';
                return;
            }

            tbody.innerHTML = officers.map(o => `
                <tr>
                    <td><strong>${o.full_name || o.username}</strong><br><small style="color:#64748b;">${o.email}</small></td>
                    <td>${o.ngo_id}</td>
                    <td>${o.role_within_ngo}</td>
                    <td>${o.is_active ? '✅ Ready' : '🔴 Suspended'}</td>
                    <td>
                        <button class="btn btn-outline btn-sm" onclick="CareAdmin.toggleOfficer('${o.id}')">Toggle</button>
                    </td>
                </tr>
            `).join('');
        } catch (e) {
            console.warn("Officer Load Fail:", e);
        }
    },

    async loadCareReports() {
        try {
            const reports = await API.get('/api/care/admin/reports');
            const tbody = document.getElementById('care-reports-tbody');
            if (!tbody) return;

            if (reports.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#94a3b8;">No humanitarian reports in queue.</td></tr>';
                return;
            }

            tbody.innerHTML = reports.map(r => `
                <tr>
                    <td><strong>${r.complaint_code}</strong><br><small style="color:#64748b;">${r.title.substring(0, 30)}...</small></td>
                    <td>${r.category}</td>
                    <td><span style="font-weight:700; color:${r.urgency_score >= 4 ? '#ef4444' : '#f59e0b'}">${r.urgency_score}/5</span></td>
                    <td>${r.assigned_ngo_id || '<span style="color:#64748b;"><i>Unassigned</i></span>'}</td>
                    <td><span class="badge badge-${r.status}">${r.status.replace('_', ' ')}</span></td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick="CareAdmin.viewReport('${r.id}')">Manage</button>
                    </td>
                </tr>
            `).join('');
        } catch (e) {
            console.warn("Care Report Load Fail:", e);
        }
    },

    // ═══════════════════════════════════════════════════════════
    // CREATE NGO MODAL
    // ═══════════════════════════════════════════════════════════

    openCreateNGOModal() {
        this.showModal("Register New NGO", `
            <form id="create-ngo-form" class="flex flex-col" style="gap:16px;">
                <div class="form-group"><label class="form-label">NGO Name</label><input type="text" name="name" class="form-input" required placeholder="e.g. HealthFirst Foundation"></div>
                <div class="form-group"><label class="form-label">Slug (unique)</label><input type="text" name="slug" class="form-input" required placeholder="e.g. health-first"></div>
                <div class="form-group"><label class="form-label">Specialization</label><input type="text" name="specialization" class="form-input" placeholder="e.g. Emergency Response"></div>
                <div class="form-group"><label class="form-label">Description</label><textarea name="description" class="form-input" rows="2" placeholder="Brief mission statement"></textarea></div>
                <div class="form-group"><label class="form-label">Contact Name</label><input type="text" name="contact_name" class="form-input" placeholder="Primary contact person"></div>
                <div class="form-group"><label class="form-label">Contact Email</label><input type="email" name="contact_email" class="form-input" required></div>
                <div class="form-group"><label class="form-label">Contact Phone</label><input type="text" name="contact_phone" class="form-input" placeholder="+91 XXXXX XXXXX"></div>
                <div class="form-group"><label class="form-label">Operating Region</label><input type="text" name="operating_region" class="form-input" placeholder="e.g. Bangalore South"></div>
                <div class="form-group"><label class="form-label">District</label><input type="text" name="district" class="form-input" placeholder="e.g. Bengaluru Urban"></div>
                <button type="submit" class="btn btn-primary" style="margin-top:8px;">Register Organization</button>
            </form>
        `);

        document.getElementById('create-ngo-form').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true; btn.textContent = "⏳ Registering...";
            const fd = new FormData(e.target);
            const body = Object.fromEntries(fd.entries());
            try {
                await API.post('/api/admin/ngos', body);
                showToast("✅ NGO Registered Successfully", "success");
                this.hideModal();
                this.loadNGOs();
                // Refresh overview stats if on care page
                if (typeof fetchCareOverview === 'function') fetchCareOverview();
            } catch (err) {
                showToast(`❌ Failed: ${err.message}`, "error");
                btn.disabled = false; btn.textContent = "Register Organization";
            }
        };
    },

    openEditNGOModal(ngoId) {
        // Placeholder — can be extended
        showToast("Edit modal — coming soon", "info");
    },

    // ═══════════════════════════════════════════════════════════
    // RECRUIT NGO OFFICER MODAL
    // ═══════════════════════════════════════════════════════════

    openRecruitOfficerModal() {
        // Build NGO dropdown from cached list
        const ngoOptions = (this._cachedNGOs || []).map(n => 
            `<option value="${n.id}">${n.name} (${n.slug})</option>`
        ).join('');

        this.showModal("Recruit NGO Officer", `
            <div style="margin-bottom:20px; color:#94a3b8; font-size:0.85rem;">Assign a trusted citizen to manage NGO operations.</div>
            <form id="recruit-officer-form" class="flex flex-col" style="gap:16px;">
                <div class="form-group">
                    <label class="form-label">User ID (UUID)</label>
                    <input type="text" name="user_id" class="form-input" required placeholder="Enter citizen UUID">
                    <small style="color:#64748b;">Copy this from the Citizen Management panel</small>
                </div>
                <div class="form-group">
                    <label class="form-label">Target NGO</label>
                    ${ngoOptions ? `<select name="ngo_id" class="form-input" required>${ngoOptions}</select>` : `<input type="text" name="ngo_id" class="form-input" required placeholder="Enter NGO UUID">`}
                </div>
                <div class="form-group">
                    <label class="form-label">Operation Role</label>
                    <input type="text" name="role_within_ngo" class="form-input" value="Lead Officer">
                </div>
                <button type="submit" class="btn btn-primary" style="margin-top:8px;">Appoint Officer</button>
            </form>
        `);

        document.getElementById('recruit-officer-form').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true; btn.textContent = "⏳ Appointing...";
            const fd = new FormData(e.target);
            const body = Object.fromEntries(fd.entries());
            try {
                await API.post('/api/admin/ngo-officers', body);
                showToast("✅ Officer Recruited & Role Elevated", "success");
                this.hideModal();
                this.loadOfficers();
                this.loadNGOs();
            } catch (err) {
                showToast(`❌ Failed: ${err.message}`, "error");
                btn.disabled = false; btn.textContent = "Appoint Officer";
            }
        };
    },

    toggleOfficer(officerId) {
        showToast("Toggle officer — coming soon", "info");
    },

    // ═══════════════════════════════════════════════════════════
    // BROADCAST ALERT MODAL
    // ═══════════════════════════════════════════════════════════

    openBroadcastModal() {
        this.showModal("Broadcast Alert", `
            <div style="margin-bottom:20px; color:#94a3b8; font-size:0.85rem;">Send an emergency or informational broadcast to the Resolvit Care network.</div>
            <form id="broadcast-form" class="flex flex-col" style="gap:16px;">
                <div class="form-group">
                    <label class="form-label">Alert Title</label>
                    <input type="text" name="title" class="form-input" required placeholder="e.g. Flood Warning — Ward 12">
                </div>
                <div class="form-group">
                    <label class="form-label">Message</label>
                    <textarea name="message" class="form-input" rows="4" required placeholder="Detailed alert message..."></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Severity</label>
                    <select name="severity" class="form-input" required>
                        <option value="info">ℹ️ Info</option>
                        <option value="warning">⚠️ Warning</option>
                        <option value="critical">🔴 Critical</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Target Region (optional)</label>
                    <input type="text" name="target_region" class="form-input" placeholder="e.g. Ward 12, Kavali">
                </div>
                <div class="form-group">
                    <label class="form-label">Target Audience</label>
                    <select name="target_role" class="form-input">
                        <option value="all">All Users</option>
                        <option value="citizen">Citizens Only</option>
                        <option value="ngo">NGOs Only</option>
                        <option value="volunteer">Volunteers Only</option>
                    </select>
                </div>
                <button type="submit" class="btn btn-primary" style="margin-top:8px; background:linear-gradient(135deg, #ef4444, #f97316);">🔊 Send Broadcast</button>
            </form>
        `);

        document.getElementById('broadcast-form').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true; btn.textContent = "⏳ Broadcasting...";
            const fd = new FormData(e.target);
            const body = Object.fromEntries(fd.entries());
            try {
                await API.post('/api/care/admin/broadcasts', body);
                showToast("📡 Broadcast Alert Sent Successfully", "success");
                this.hideModal();
                // Refresh timeline if visible
                if (typeof fetchOpsTimeline === 'function') fetchOpsTimeline();
            } catch (err) {
                showToast(`❌ Broadcast Failed: ${err.message}`, "error");
                btn.disabled = false; btn.textContent = "🔊 Send Broadcast";
            }
        };
    },

    // ═══════════════════════════════════════════════════════════
    // VOLUNTEER MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    openCreateVolunteerModal() {
        // Build NGO dropdown from cached list
        const ngoOptions = (this._cachedNGOs || []).map(n => 
            `<option value="${n.id}">${n.name}</option>`
        ).join('');

        this.showModal("Register Volunteer", `
            <form id="create-volunteer-form" class="flex flex-col" style="gap:16px;">
                <div class="form-group"><label class="form-label">Full Name</label><input type="text" name="full_name" class="form-input" required placeholder="Volunteer full name"></div>
                <div class="form-group"><label class="form-label">Email</label><input type="email" name="email" class="form-input" required></div>
                <div class="form-group"><label class="form-label">Phone</label><input type="text" name="phone" class="form-input" placeholder="+91 XXXXX XXXXX"></div>
                <div class="form-group"><label class="form-label">Skills</label><input type="text" name="skills" class="form-input" placeholder="e.g. First Aid, Logistics, Translation"></div>
                <div class="form-group"><label class="form-label">Languages</label><input type="text" name="languages" class="form-input" placeholder="e.g. English, Telugu, Hindi"></div>
                <div class="form-group"><label class="form-label">Region</label><input type="text" name="current_region" class="form-input" placeholder="e.g. Kavali, Nellore"></div>
                <div class="form-group">
                    <label class="form-label">Linked NGO (optional)</label>
                    <select name="ngo_id" class="form-input">
                        <option value="">— Independent —</option>
                        ${ngoOptions}
                    </select>
                </div>
                <button type="submit" class="btn btn-primary" style="margin-top:8px;">Register Volunteer</button>
            </form>
        `);

        document.getElementById('create-volunteer-form').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true; btn.textContent = "⏳ Registering...";
            const fd = new FormData(e.target);
            const body = Object.fromEntries(fd.entries());
            if (!body.ngo_id) delete body.ngo_id; // Don't send empty string
            try {
                await API.post('/api/care/admin/volunteers', body);
                showToast("✅ Volunteer Registered", "success");
                this.hideModal();
                if (typeof fetchVolunteers === 'function') fetchVolunteers();
                if (typeof fetchCareOverview === 'function') fetchCareOverview();
            } catch (err) {
                showToast(`❌ Failed: ${err.message}`, "error");
                btn.disabled = false; btn.textContent = "Register Volunteer";
            }
        };
    },

    // ═══════════════════════════════════════════════════════════
    // REPORT ACTIONS
    // ═══════════════════════════════════════════════════════════

    viewReport(id) {
        if (window.DetailManager) {
            DetailManager.open(id, 'care');
        }
    },

    async openAssignNGOModal(reportId) {
        const ngoOptions = (this._cachedNGOs || []).map(n =>
            `<option value="${n.id}">${n.name} (${n.specialization || 'General'})</option>`
        ).join('');

        this.showModal("Assign NGO to Report", `
            <form id="assign-ngo-form" class="flex flex-col" style="gap:16px;">
                <div class="form-group">
                    <label class="form-label">Select NGO</label>
                    <select name="ngo_id" class="form-input" required>${ngoOptions || '<option value="">No NGOs available</option>'}</select>
                </div>
                <div class="form-group">
                    <label class="form-label">Assignment Reason</label>
                    <textarea name="assignment_reason" class="form-input" rows="2" placeholder="Why this NGO?"></textarea>
                </div>
                <button type="submit" class="btn btn-primary" style="margin-top:8px;">Assign NGO</button>
            </form>
        `);

        document.getElementById('assign-ngo-form').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true; btn.textContent = "⏳ Assigning...";
            const fd = new FormData(e.target);
            const body = Object.fromEntries(fd.entries());
            try {
                await API.post(`/api/care/admin/reports/${reportId}/assign-ngo`, body);
                showToast("✅ NGO Assigned", "success");
                this.hideModal();
                this.loadCareReports();
            } catch (err) {
                showToast(`❌ Failed: ${err.message}`, "error");
                btn.disabled = false; btn.textContent = "Assign NGO";
            }
        };
    },

    async openResolveModal(reportId) {
        this.showModal("Resolve Report", `
            <form id="resolve-report-form" class="flex flex-col" style="gap:16px;">
                <div class="form-group">
                    <label class="form-label">Resolution Summary</label>
                    <textarea name="resolution_summary" class="form-input" rows="4" required placeholder="Describe resolution actions taken..."></textarea>
                </div>
                <div class="form-group" style="display:flex; align-items:center; gap:12px;">
                    <input type="checkbox" name="send_email" id="resolve-send-email" checked>
                    <label for="resolve-send-email" class="form-label" style="margin:0;">Send resolution email to reporter</label>
                </div>
                <button type="submit" class="btn btn-primary" style="margin-top:8px; background:linear-gradient(135deg, #10b981, #059669);">✅ Mark Resolved</button>
            </form>
        `);

        document.getElementById('resolve-report-form').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true; btn.textContent = "⏳ Resolving...";
            const fd = new FormData(e.target);
            const body = {
                resolution_summary: fd.get('resolution_summary'),
                send_email: !!fd.get('send_email')
            };
            try {
                await API.post(`/api/care/admin/reports/${reportId}/resolve`, body);
                showToast("✅ Report Resolved Successfully", "success");
                this.hideModal();
                this.loadCareReports();
                if (typeof fetchCareOverview === 'function') fetchCareOverview();
                if (typeof fetchRealCareData === 'function') fetchRealCareData();
            } catch (err) {
                showToast(`❌ Failed: ${err.message}`, "error");
                btn.disabled = false; btn.textContent = "✅ Mark Resolved";
            }
        };
    }
};
