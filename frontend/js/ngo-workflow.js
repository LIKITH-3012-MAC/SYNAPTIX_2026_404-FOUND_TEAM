/**
 * RESOLVIT - NGO Workflow Module (ngo-workflow.js)
 * Fetches NGO assignments, marks them seen, manages updates, and handles UI maps.
 */

window.NGOWorkflow = {
    myAssignments: [],
    selectedAssignment: null,
    map: null,
    marker: null,

    async init() {
        // 1. Session Auth guard
        if (!Auth.getUser()) {
            Auth.showModal('login');
            return;
        }
        if (!Auth.requireRole('ngo', 'index.html')) return;

        // 2. Setup user welcome details
        const user = Auth.getUser();
        document.getElementById('ngo-user-email').textContent = user.email;
        
        // 3. Load NGO Assignments
        await this.loadAssignments();
        
        // 4. Bind event listeners
        this.bindEvents();
    },

    bindEvents() {
        // Modal overlay click closing
        const modal = document.getElementById('ngo-details-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeModal();
            });
        }
    },

    async loadAssignments() {
        try {
            const listEl = document.getElementById('ngo-assignments-list');
            listEl.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">⏳ Loading assignments...</div>';
            
            const assignments = await API.get('/api/ngo/my-assignments');
            this.myAssignments = assignments;

            if (assignments.length > 0 && assignments[0].ngo_name) {
                document.getElementById('ngo-name-title').textContent = assignments[0].ngo_name;
            } else {
                document.getElementById('ngo-name-title').textContent = "Resolvit Partner NGO";
            }

            if (assignments.length === 0) {
                listEl.innerHTML = `
                    <div style="text-align:center; padding:60px 20px; background:var(--card-bg); border-radius:20px; border:1px solid var(--glass-border);">
                        <div style="font-size:3rem; margin-bottom:16px;">🎉</div>
                        <h3 style="margin-bottom:8px;">All Clean!</h3>
                        <p style="color:var(--text-muted); font-size:0.95rem;">No issues are currently assigned to your email.</p>
                    </div>
                `;
                return;
            }

            listEl.innerHTML = '';
            assignments.forEach(asg => {
                const card = this.createAssignmentCard(asg);
                listEl.appendChild(card);

                // If assignment is new/unseen, trigger the blink highlight and call API after 3s
                if (asg.is_new || !asg.seen_by_ngo) {
                    setTimeout(async () => {
                        try {
                            card.classList.remove('new-assignment');
                            await API.post(`/api/ngo/assignments/${asg.id}/mark-seen`);
                            // update local status
                            asg.is_new = false;
                            asg.seen_by_ngo = true;
                        } catch (err) {
                            console.warn("Could not mark assignment as seen:", err);
                        }
                    }, 3000);
                }
            });

        } catch (e) {
            console.error("Failed to load assignments:", e);
            document.getElementById('ngo-assignments-list').innerHTML = `
                <div class="alert alert-error">❌ Error loading assignments: ${e.message}</div>
            `;
        }
    },

    createAssignmentCard(asg) {
        const isNew = asg.is_new || !asg.seen_by_ngo;
        const card = document.createElement('div');
        card.className = `glass-card-premium ${isNew ? 'new-assignment' : ''}`;
        card.style.padding = '24px';
        card.style.borderRadius = '20px';
        card.style.border = '1px solid var(--glass-border)';
        card.style.position = 'relative';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '14px';

        const dateStr = asg.assigned_at ? new Date(asg.assigned_at).toLocaleDateString() : 'N/A';
        const badgeColors = {
            'assigned': 'background:rgba(99,102,241,0.1); color:#818cf8; border:1px solid rgba(99,102,241,0.2)',
            'accepted': 'background:rgba(59,130,246,0.1); color:#60a5fa; border:1px solid rgba(59,130,246,0.2)',
            'in progress': 'background:rgba(245,158,11,0.1); color:#fbbf24; border:1px solid rgba(245,158,11,0.2)',
            'solved': 'background:rgba(16,185,129,0.1); color:#34d399; border:1px solid rgba(16,185,129,0.2)',
            'rejected': 'background:rgba(239,68,68,0.1); color:#f87171; border:1px solid rgba(239,68,68,0.2)'
        };
        const st = String(asg.status).toLowerCase();
        const badgeStyle = badgeColors[st] || 'background:rgba(255,255,255,0.05); color:#94a3b8';

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <span class="badge" style="padding:4px 10px; border-radius:12px; font-size:0.75rem; font-weight:700; text-transform:uppercase; ${badgeStyle}">
                    ${asg.status}
                </span>
                <span style="font-size:0.8rem; color:var(--text-muted); font-weight:500;">📅 Assigned: ${dateStr}</span>
            </div>
            
            <div>
                <h3 style="font-size:1.2rem; font-weight:800; margin-bottom:6px; color:#ffffff;">${asg.issue_title}</h3>
                <p style="color:var(--text-muted); font-size:0.9rem; line-height:1.5; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">
                    ${asg.issue_description || 'No description provided.'}
                </p>
            </div>

            <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.04); border-radius:12px; padding:12px; font-size:0.85rem; display:flex; align-items:center; gap:8px;">
                <span style="font-size:1.1rem;">📍</span>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:700; color:#cbd5e1;">Location Highlighted:</div>
                    <div style="color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${asg.issue_location || 'N/A'}
                    </div>
                </div>
            </div>

            ${asg.admin_message ? `
            <div style="background:rgba(99,102,241,0.05); border-left:3px solid var(--primary); border-radius:4px 12px 12px 4px; padding:10px 14px; font-size:0.82rem;">
                <strong style="color:var(--primary);">Admin Message:</strong>
                <span style="color:#cbd5e1;">${asg.admin_message}</span>
            </div>` : ''}

            <div style="margin-top:auto; padding-top:12px;">
                <button class="btn btn-primary" onclick="NGOWorkflow.viewDetails('${asg.id}')" style="width:100%; border-radius:12px; font-weight:700; font-size:0.9rem; display:flex; align-items:center; justify-content:center; gap:8px;">
                    👁️ View Assigned NGO Issue
                </button>
            </div>
        `;
        return card;
    },

    viewDetails(assignmentId) {
        const asg = this.myAssignments.find(a => a.id === assignmentId);
        if (!asg) return;
        
        this.selectedAssignment = asg;
        
        // Show details in modal
        document.getElementById('modal-issue-title').textContent = asg.issue_title;
        document.getElementById('modal-issue-desc').textContent = asg.issue_description || 'No description provided.';
        document.getElementById('modal-issue-location').textContent = asg.issue_location || 'N/A';
        document.getElementById('modal-admin-msg').textContent = asg.admin_message || 'No instructions provided.';
        const statusEl = document.getElementById('modal-current-status');
        if (statusEl) {
            statusEl.textContent = asg.status;
            statusEl.className = 'badge';
            const normStatus = asg.status.replace(' ', '_');
            statusEl.classList.add(`badge-${normStatus}`);
        }

        // Render form options
        document.getElementById('status-update-form').reset();
        document.getElementById('update-status-select').value = asg.status;

        // Render mini leaflet map
        this.showMiniMap(asg.latitude, asg.longitude, asg.issue_title, asg.issue_location);

        // Open Modal
        document.getElementById('ngo-details-modal').style.display = 'flex';
        
        // Fetch and show update history
        this.loadUpdateHistory(asg.issue_id);
    },

    closeModal() {
        document.getElementById('ngo-details-modal').style.display = 'none';
        this.selectedAssignment = null;
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
    },

    showMiniMap(lat, lng, title, locationText) {
        const defaultLat = lat || 12.9716;
        const defaultLng = lng || 77.5946;

        setTimeout(() => {
            try {
                if (this.map) {
                    this.map.remove();
                }

                this.map = L.map('modal-map', {
                    zoomControl: true,
                    attributionControl: false
                }).setView([defaultLat, defaultLng], 14);

                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                    maxZoom: 20
                }).addTo(this.map);

                const icon = L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div style="background-color:var(--primary); width:14px; height:14px; border:2px solid white; border-radius:50%; box-shadow:0 0 10px var(--primary); animation: pulse 2s infinite;"></div>`,
                    iconSize: [14, 14],
                    iconAnchor: [7, 7]
                });

                this.marker = L.marker([defaultLat, defaultLng], { icon }).addTo(this.map);
                this.marker.bindPopup(`<b>${title}</b><br><small>${locationText}</small>`).openPopup();
                
                // Trigger resize in Leaflet to draw properly
                this.map.invalidateSize();

            } catch (err) {
                console.error("Leaflet Map init error:", err);
            }
        }, 300);
    },

    async loadUpdateHistory(issueId) {
        const container = document.getElementById('modal-update-timeline');
        container.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Loading timeline...</div>';
        
        try {
            const updates = await API.get(`/api/admin/issues/${issueId}/updates`);
            if (updates.length === 0) {
                container.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; font-style:italic;">No updates logged yet.</div>';
                return;
            }

            container.innerHTML = updates.map(upd => {
                const date = new Date(upd.created_at).toLocaleString();
                return `
                    <div style="border-left:2px solid rgba(255,255,255,0.1); padding-left:14px; margin-bottom:16px; position:relative;">
                        <div style="width:10px; height:10px; border-radius:50%; background:var(--primary); position:absolute; left:-6px; top:4px;"></div>
                        <div style="display:flex; justify-content:space-between; font-size:0.78rem; color:var(--text-muted); margin-bottom:4px;">
                            <strong>${upd.ngo_name} (${upd.ngo_email})</strong>
                            <span>${date}</span>
                        </div>
                        <div style="font-weight:700; font-size:0.85rem; color:#ffffff; margin-bottom:4px; text-transform:uppercase;">
                            Status Changed to: <span style="color:var(--primary);">${upd.status}</span>
                        </div>
                        <div style="font-size:0.85rem; color:#cbd5e1; line-height:1.4;">
                            ${upd.update_message || 'No comments left.'}
                        </div>
                        ${upd.proof_image_url ? `
                        <div style="margin-top:8px;">
                            <a href="${upd.proof_image_url}" target="_blank" style="display:inline-flex; align-items:center; gap:6px; font-size:0.78rem; color:var(--primary); text-decoration:none; font-weight:700;">
                                🖼️ View Uploaded Proof Image
                            </a>
                        </div>` : ''}
                    </div>
                `;
            }).join('');
        } catch (e) {
            container.innerHTML = `<div style="color:var(--error); font-size:0.85rem;">Failed to load update log: ${e.message}</div>`;
        }
    },

    async submitUpdate(e) {
        e.preventDefault();
        if (!this.selectedAssignment) return;

        const btn = document.getElementById('btn-submit-update');
        btn.disabled = true;
        btn.textContent = '⏳ Submitting...';

        const statusVal = document.getElementById('update-status-select').value;
        const messageVal = document.getElementById('update-message-input').value.trim();
        const proofUrlVal = document.getElementById('update-proof-input').value.trim();

        try {
            await API.put(`/api/ngo/assignments/${this.selectedAssignment.id}/status`, {
                status: statusVal,
                update_message: messageVal,
                proof_image_url: proofUrlVal || null
            });

            showToast("✅ Issue updated successfully!", "success");
            this.closeModal();
            await this.loadAssignments();
        } catch (err) {
            showToast(`❌ Failed: ${err.message}`, "error");
        } finally {
            btn.disabled = false;
            btn.textContent = 'Submit Operational Update';
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.NGOWorkflow.init();
});
