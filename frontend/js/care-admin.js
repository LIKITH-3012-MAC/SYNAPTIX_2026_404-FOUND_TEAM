/**
 * RESOLVIT CARE - Admin Command Logic
 * Manages NGO records, officer assignments, and global care report oversight.
 */

window.CareAdmin = {
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

    async loadNGOs() {
        try {
            const ngos = await API.get('/api/admin/ngos');
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

    openCreateNGOModal() {
        this.showModal("Register New NGO", `
            <form id="create-ngo-form" class="flex flex-col" style="gap:16px;">
                <div class="form-group"><label class="form-label">NGO Name</label><input type="text" name="name" class="form-input" required placeholder="e.g. HealthFirst Foundation"></div>
                <div class="form-group"><label class="form-label">Slug (unique)</label><input type="text" name="slug" class="form-input" required placeholder="e.g. health-first"></div>
                <div class="form-group"><label class="form-label">Specialization</label><input type="text" name="specialization" class="form-input" placeholder="e.g. Emergency Response"></div>
                <div class="form-group"><label class="form-label">Contact Email</label><input type="email" name="contact_email" class="form-input" required></div>
                <div class="form-group"><label class="form-label">Operating Region</label><input type="text" name="operating_region" class="form-input" placeholder="e.g. Bangalore South"></div>
                <button type="submit" class="btn btn-primary" style="margin-top:8px;">Register Organization</button>
            </form>
        `);

        document.getElementById('create-ngo-form').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            btn.disabled = true; btn.textContent = "⏳ Registering...";
            const fd = new FormData(e.target);
            const body = Object.fromEntries(fd.entries());
            try {
                await API.post('/api/admin/ngos', body);
                showToast("✅ NGO Registered Successfully", "success");
                this.hideModal();
                this.loadNGOs();
            } catch (err) {
                showToast(`❌ Failed: ${err.message}`, "error");
                btn.disabled = false; btn.textContent = "Register Organization";
            }
        };
    },

    openRecruitOfficerModal() {
        this.showModal("Recruit NGO Officer", `
            <div style="margin-bottom:20px; color:#94a3b8; font-size:0.85rem;">Assign a trusted citizen to manage NGO operations.</div>
            <form id="recruit-officer-form" class="flex flex-col" style="gap:16px;">
                <div class="form-group">
                    <label class="form-label">User ID (UUID)</label>
                    <input type="text" name="user_id" class="form-input" required placeholder="Enter citizen UUID">
                    <small style="color:#64748b;">Copy this from the Citizen Management panel</small>
                </div>
                <div class="form-group">
                    <label class="form-label">Target NGO ID</label>
                    <input type="text" name="ngo_id" class="form-input" required placeholder="Enter NGO UUID">
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
            const btn = e.target.querySelector('button');
            btn.disabled = true; btn.textContent = "⏳ Appointing...";
            const fd = new FormData(e.target);
            const body = Object.fromEntries(fd.entries());
            try {
                await API.post('/api/admin/ngo-officers', body);
                showToast("🎨 Officer Recruited & Role Elevated", "success");
                this.hideModal();
                this.loadOfficers();
                this.loadNGOs(); // Refresh to see potential updated counts
            } catch (err) {
                showToast(`❌ Failed: ${err.message}`, "error");
                btn.disabled = false; btn.textContent = "Appoint Officer";
            }
        };
    },

    viewReport(id) {
        if (window.DetailManager) {
            DetailManager.open(id, 'care');
        }
    }
};

// Auto-init when panel is shown
const originalShowPanel = window.showPanel;
window.showPanel = function(id) {
    if (typeof originalShowPanel === 'function') originalShowPanel(id);
    if (id === 'ngo-panel' || id === 'care-reports-panel') {
        CareAdmin.init();
    }
};
