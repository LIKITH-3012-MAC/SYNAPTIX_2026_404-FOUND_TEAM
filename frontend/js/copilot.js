/**
 * RESOLVIT AI COPILOT v2 (Production Engine)
 * Rebuilt as a state-driven, AI-integrated workflow system.
 */

const COPILOT_STATES = {
    INIT: 'INIT',
    COLLECT_TITLE: 'COLLECT_TITLE',
    COLLECT_CATEGORY: 'COLLECT_CATEGORY',
    COLLECT_DESCRIPTION: 'COLLECT_DESCRIPTION',
    COLLECT_SEVERITY: 'COLLECT_SEVERITY',
    COLLECT_PEOPLE: 'COLLECT_PEOPLE',
    COLLECT_LOCATION: 'COLLECT_LOCATION',
    COLLECT_EVIDENCE: 'COLLECT_EVIDENCE',
    PREVIEW: 'PREVIEW',
    CONFIRM: 'CONFIRM',
    SUBMITTING: 'SUBMITTING',
    SUCCESS: 'SUCCESS',
    ERROR: 'ERROR'
};

const VALID_CATEGORIES = ['Roads', 'Water', 'Sanitation', 'Safety', 'Electricity', 'Environment', 'Other'];

class ResolvitCopilot {
    constructor(config = {}) {
        const baseUrl = window.BASE_URL || '';
        this.apiUrl = baseUrl + '/api/chat';
        this.intakeUrl = baseUrl + '/api/chat/complaint-intake';

        this.role = config.role || 'citizen';
        this.chatHistory = [];
        this.isOpen = false;
        this.isTyping = false;

        // Complaint State Machine
        this.state = COPILOT_STATES.INIT;
        this.issueDraft = {
            title: '',
            category: '',
            description: '',
            urgency: 3,
            impact_scale: 1,
            location_text: '',
            latitude: null,
            longitude: null,
            image_url: '',
            source: 'copilot_chat'
        };

        this.initDOM();
        this.bindEvents();
        this.recoverDraft();
    }

    getNeuralIcon(sizeClass = '') {
        return `
            <div class="ai-premium-identity ${sizeClass}">
                <div class="ai-neural-ring"></div>
                <div class="ai-spark-glow"></div>
                <i class="fas fa-brain" style="position:relative; z-index:2;"></i>
            </div>
        `;
    }

    initDOM() {
        const copilotHTML = `
            <!-- Launcher Orb -->
            <div id="copilot-launcher" class="copilot-launcher">
                ${this.getNeuralIcon()}
            </div>

            <!-- Main Panel -->
            <div id="copilot-panel" class="copilot-panel">
                <div class="copilot-header">
                    <div class="copilot-brand">
                        <div class="copilot-icon">
                            ${this.getNeuralIcon()}
                        </div>
                        <div class="copilot-title-container">
                            <span class="copilot-title">Resolvit AI Copilot</span>
                            <span class="copilot-status"><div class="copilot-status-dot"></div> Production Engine • Role: ${this.role.toUpperCase()}</span>
                        </div>
                    </div>
                    <button id="copilot-close" class="copilot-btn" style="color:white;"><i class="fas fa-times"></i></button>
                </div>

                <div id="copilot-messages" class="copilot-messages">
                    <div class="msg-container msg-ai">
                        <div class="ai-avatar"><i class="fas fa-robot"></i></div>
                        <div class="msg-bubble">
                            <p>Hello! I am your <strong>Resolvit AI Copilot</strong>.</p>
                            <p>I was developed by <strong>Likith Naidu Anumakonda</strong> for the RESOLVIT platform.</p>
                            <p>I can help you report civic issues intelligently. What's on your mind?</p>
                        </div>
                    </div>
                </div>

                <div class="copilot-footer">
                    <div id="copilot-suggestions" class="copilot-suggestions">
                        ${this.getSuggestions()}
                    </div>
                    
                    <div class="copilot-input-wrapper">
                        <button class="copilot-btn" id="copilot-attach" title="Attach Evidence"><i class="fas fa-camera"></i></button>
                        <input type="text" id="copilot-input" class="copilot-input" placeholder="Ask anything or report an issue..." autocomplete="off">
                        <button class="copilot-btn" id="copilot-voice" title="Voice Input"><i class="fas fa-microphone"></i></button>
                        <button id="copilot-send" class="copilot-btn copilot-send-btn"><i class="fas fa-paper-plane"></i></button>
                    </div>
                </div>
            </div>
        `;
        
        if (!document.getElementById('copilot-launcher')) {
            document.body.insertAdjacentHTML('beforeend', copilotHTML);
        }

        this.launcher = document.getElementById('copilot-launcher');
        this.panel = document.getElementById('copilot-panel');
        this.closeBtn = document.getElementById('copilot-close');
        this.input = document.getElementById('copilot-input');
        this.sendBtn = document.getElementById('copilot-send');
        this.messagesDiv = document.getElementById('copilot-messages');
        this.suggestContainer = document.getElementById('copilot-suggestions');
    }

    bindEvents() {
        this.launcher.addEventListener('click', () => this.togglePanel());
        this.closeBtn.addEventListener('click', () => this.togglePanel());

        this.sendBtn.addEventListener('click', () => this.handleSend());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSend();
        });

        this.suggestContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('copilot-suggestion-chip')) {
                this.input.value = e.target.innerText;
                this.handleSend();
            }
        });

        // Auth resume listener — same-tab custom event (primary)
        window.addEventListener('resolvit-auth-success', () => {
            if (this.state === COPILOT_STATES.CONFIRM) {
                this.appendMessage('ai', '✅ **Identity verified.** Submitting your report now...');
                this.submitComplaint();
            }
        });

        // Auth resume listener — cross-tab fallback via storage event
        window.addEventListener('storage', (e) => {
            if (e.key === 'resolvit_token' && e.newValue && this.state === COPILOT_STATES.CONFIRM) {
                this.appendMessage('ai', '✅ **Identity verified.** Submitting your report now...');
                this.submitComplaint();
            }
        });

        // Resume after redirect-based login (e.g. returnTo=chatbot-report)
        if (window.location.search.includes('returnTo=chatbot-report') || sessionStorage.getItem('copilot_login_pending')) {
            sessionStorage.removeItem('copilot_login_pending');
            const token = localStorage.getItem('resolvit_token');
            if (token) {
                setTimeout(() => {
                    if (this.state === COPILOT_STATES.CONFIRM || this.state === COPILOT_STATES.PREVIEW) {
                        this.appendMessage('ai', '✅ **Welcome back!** Submitting your saved report...');
                        this.submitComplaint();
                    }
                }, 800);
            }
        }
    }

    getSuggestions() {
        if (this.state === COPILOT_STATES.INIT) {
            return `
                <div class="copilot-suggestion-chip">Report an issue</div>
                <div class="copilot-suggestion-chip">Check map clusters</div>
                <div class="copilot-suggestion-chip">Who built you?</div>
            `;
        }
        return '';
    }

    updateSuggestions() {
        if (this.suggestContainer) {
            this.suggestContainer.innerHTML = this.getSuggestions();
        }
    }

    togglePanel() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.panel.classList.add('open');
            this.launcher.classList.add('active');
            this.input.focus();
        } else {
            this.panel.classList.remove('open');
            this.launcher.classList.remove('active');
        }
    }

    async handleSend() {
        const text = this.input.value.trim();
        if (!text && this.state !== COPILOT_STATES.CONFIRM) return;

        if (text) {
            this.input.value = '';
            this.appendMessage('user', text);
            this.chatHistory.push({ role: "user", content: text });
        }

        this.showTyping();

        try {
            await this.processState(text);
        } catch (error) {
            console.error("Copilot Error:", error);
            this.appendMessage('ai', "Neural link encountered a system-level anomaly. Please try again.");
        } finally {
            this.removeTyping();
        }
    }

    async processState(input) {
        // AI INTENT DETECTION (Simplified for now, can use backend)
        if (this.state === COPILOT_STATES.INIT) {
            if (input.toLowerCase().includes('report') || input.toLowerCase().includes('issue') || input.toLowerCase().includes('problem')) {
                this.state = COPILOT_STATES.COLLECT_TITLE;
                this.updateSuggestions();
                this.appendMessage('ai', "🚀 **Excellent.** Let's build a structured report.\n\nWhat is the **main title** of this incident? (Keep it short and descriptive, at least 10 characters)");
                return;
            }
            if (input.toLowerCase().includes('who built you') || input.toLowerCase().includes('creator')) {
                this.appendMessage('ai', "I was developed by **Likith Naidu Anumakonda** for the RESOLVIT platform. My purpose is to bridge the gap between citizens and authorities through AI.");
                return;
            }
            
            // Standard Chat
            const data = await this.callBackendCopilot();
            this.appendMessage('ai', data.text, data.sources);
            return;
        }

        switch (this.state) {
            case COPILOT_STATES.COLLECT_TITLE:
                if (input.length < 10) {
                    this.appendMessage('ai', '⚠️ Title must be at least **10 characters**. Please provide a more descriptive title.');
                    return;
                }
                this.issueDraft.title = input;
                this.state = COPILOT_STATES.COLLECT_CATEGORY;
                this.updateSuggestions();
                this.appendMessage('ai', `✅ **Title Captured.**\n\nWhat **category** does this fall into? (Roads, Water, Sanitation, Safety, Electricity, Other)`);
                this.renderCategoryPicker();
                break;

            case COPILOT_STATES.COLLECT_CATEGORY: {
                // Validate category against allowed values
                const matchedCat = VALID_CATEGORIES.find(c => c.toLowerCase() === input.toLowerCase());
                if (!matchedCat) {
                    this.appendMessage('ai', `⚠️ "${input}" is not a valid category. Please choose one of:\n**${VALID_CATEGORIES.join(', ')}**`);
                    this.renderCategoryPicker();
                    return; // Do NOT advance state or save draft
                }
                this.issueDraft.category = matchedCat;
                this.state = COPILOT_STATES.COLLECT_DESCRIPTION;
                this.updateSuggestions();
                this.appendMessage('ai', "🔍 **Classification noted.**\n\nPlease provide a **detailed description** of what's happening (at least 20 characters). The more detail, the higher the priority score.");
                break;
            }

            case COPILOT_STATES.COLLECT_DESCRIPTION:
                if (input.length < 20) {
                    this.appendMessage('ai', '⚠️ Description must be at least **20 characters**. Please provide more detail about the issue.');
                    return;
                }
                this.issueDraft.description = input;
                this.state = COPILOT_STATES.COLLECT_LOCATION;
                this.updateSuggestions();
                this.appendMessage('ai', "📍 **Awaiting Geospatial Focus.**\n\nWhere is this happening? You can share your **GPS Location** for 100% precision, or type the area name.");
                this.renderLocationPicker();
                break;

            case COPILOT_STATES.COLLECT_LOCATION:
                if (input) this.issueDraft.location_text = input;
                this.state = COPILOT_STATES.COLLECT_SEVERITY;
                this.updateSuggestions();
                this.appendMessage('ai', "⚠️ **Impact Assessment.**\n\nOn a scale of 1-5, how **urgent** is this? (1: Low, 5: Critical)");
                this.renderSeveritySlider();
                break;

            case COPILOT_STATES.COLLECT_SEVERITY:
                this.issueDraft.urgency = Math.max(1, Math.min(5, parseInt(input) || 3));
                this.state = COPILOT_STATES.PREVIEW;
                this.updateSuggestions();
                this.renderPreview();
                break;

            case COPILOT_STATES.PREVIEW:
                if (input.toLowerCase().includes('confirm') || input.toLowerCase().includes('submit')) {
                    this.submitComplaint();
                } else if (input.toLowerCase().includes('edit')) {
                    this.state = COPILOT_STATES.COLLECT_TITLE;
                    this.updateSuggestions();
                    this.appendMessage('ai', "Restarting flow. What's the new title?");
                }
                break;
        }

        this.saveDraft();
    }

    renderCategoryPicker() {
        const categories = ['Roads', 'Water', 'Sanitation', 'Safety', 'Electricity', 'Other'];
        const chipContainer = document.createElement('div');
        chipContainer.className = 'msg-container msg-ai';
        let html = '<div class="ai-avatar"><i class="fas fa-robot"></i></div><div class="msg-bubble category-picker"><div class="chip-grid">';
        categories.forEach(cat => {
            html += `<button class="category-chip" onclick="window.resolvitCopilotInstance.setCategory('${cat}')">${cat}</button>`;
        });
        html += '</div></div>';
        chipContainer.innerHTML = html;
        this.messagesDiv.appendChild(chipContainer);
        this.scrollToBottom();
    }

    setCategory(cat) {
        this.input.value = cat;
        this.handleSend();
    }

    renderLocationPicker() {
        const container = document.createElement('div');
        container.className = 'msg-container msg-ai';
        container.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="msg-bubble location-picker">
                <button class="copilot-card-btn gps-btn" onclick="window.resolvitCopilotInstance.captureGPS()">
                    <i class="fas fa-location-arrow"></i> Use Live GPS
                </button>
                <div style="margin-top:10px; font-size: 0.75rem; color: #94a3b8; text-align:center;">OR Type Area Name Below</div>
            </div>
        `;
        this.messagesDiv.appendChild(container);
        this.scrollToBottom();
    }

    async captureGPS() {
        if (!navigator.geolocation) {
            this.appendMessage('ai', "Geolocation is not supported by your browser.");
            return;
        }

        this.appendMessage('ai', "🛰️ **Interfacing with orbital satellites...**");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                this.issueDraft.latitude = pos.coords.latitude;
                this.issueDraft.longitude = pos.coords.longitude;
                this.issueDraft.location_text = "GPS Coordinate Sync Success";
                this.appendMessage('ai', `✅ **GPS Locked:** ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
                this.handleSend();
            },
            (err) => {
                this.appendMessage('ai', "⚠️ **Signal Lost.** Please enter the location manually.");
            }
        );
    }

    renderSeveritySlider() {
        const container = document.createElement('div');
        container.className = 'msg-container msg-ai';
        container.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="msg-bubble severity-picker">
                <input type="range" min="1" max="5" step="1" id="severity-range" value="3" list="sev-marks" style="width:100%;">
                <datalist id="sev-marks"><option value="1"><option value="2"><option value="3"><option value="4"><option value="5"></datalist>
                <div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-top:5px; color:#94a3b8;">
                    <span>Routine</span>
                    <span>Critical</span>
                </div>
                <button class="copilot-card-btn primary" style="margin-top:15px; width:100%;" onclick="window.resolvitCopilotInstance.setSeverity()">Set Urgency</button>
            </div>
        `;
        this.messagesDiv.appendChild(container);
        this.scrollToBottom();
    }

    setSeverity() {
        const val = document.getElementById('severity-range').value;
        this.input.value = val;
        this.handleSend();
    }

    renderPreview() {
        const d = this.issueDraft;
        const container = document.createElement('div');
        container.className = 'msg-container msg-ai';
        container.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="msg-bubble preview-card glass-card">
                <div class="preview-header"><i class="fas fa-clipboard-check"></i> Report Summary</div>
                <div class="preview-item"><strong>Title:</strong> ${d.title}</div>
                <div class="preview-item"><strong>Category:</strong> ${d.category}</div>
                <div class="preview-item"><strong>Description:</strong> ${d.description}</div>
                <div class="preview-item"><strong>Location:</strong> ${d.location_text} ${d.latitude ? '🛰️' : '✍️'}</div>
                <div class="preview-item"><strong>Urgency:</strong> Level ${d.urgency}</div>
                <div style="display:flex; gap:10px; margin-top:15px;">
                    <button class="copilot-card-btn primary" style="flex:2;" onclick="window.resolvitCopilotInstance.submitComplaint()">Confirm & Submit</button>
                    <button class="copilot-card-btn secondary" style="flex:1;" onclick="window.resolvitCopilotInstance.editComplaint()">Edit</button>
                </div>
            </div>
        `;
        this.messagesDiv.appendChild(container);
        this.scrollToBottom();
    }

    editComplaint() {
        this.input.value = "edit";
        this.handleSend();
    }

    /**
     * Parse backend error responses into a human-readable string.
     * Handles Pydantic validation error arrays, string details, and unknown shapes.
     */
    _parseErrorDetail(detail) {
        if (!detail) return null;
        if (typeof detail === 'string') return detail;
        if (Array.isArray(detail)) {
            // Pydantic validation errors: [{loc:[...], msg:"...", type:"..."}]
            const msgs = detail.map(e => {
                if (typeof e === 'string') return e;
                if (e && typeof e === 'object') {
                    const field = Array.isArray(e.loc) ? e.loc.filter(l => l !== 'body').join('.') : '';
                    const msg = e.msg || 'invalid';
                    return field ? `${field}: ${msg}` : msg;
                }
                return String(e);
            });
            return msgs.join('\n');
        }
        if (typeof detail === 'object') {
            return detail.msg || detail.message || JSON.stringify(detail);
        }
        return String(detail);
    }

    /**
     * Validate the issue draft before submitting to the backend.
     * Returns null if valid, or an error message string if invalid.
     */
    _validateDraft() {
        const d = this.issueDraft;
        const errors = [];
        if (!d.title || d.title.length < 10) errors.push('Title must be at least 10 characters');
        if (!d.category || !VALID_CATEGORIES.includes(d.category)) errors.push(`Category must be one of: ${VALID_CATEGORIES.join(', ')}`);
        if (!d.description || d.description.length < 20) errors.push('Description must be at least 20 characters');
        const urg = parseInt(d.urgency);
        if (isNaN(urg) || urg < 1 || urg > 5) errors.push('Urgency must be a number from 1 to 5');
        return errors.length > 0 ? errors.join('\n') : null;
    }

    async submitComplaint() {
        // AUTH GATE
        const token = localStorage.getItem('resolvit_token');
        if (!token) {
            this.state = COPILOT_STATES.CONFIRM;
            this.saveDraft();
            this.renderAuthGate();
            return;
        }

        // PRE-SUBMIT VALIDATION
        const validationError = this._validateDraft();
        if (validationError) {
            this.appendMessage('ai', `⚠️ **Payload validation failed:**\n${validationError}\n\nPlease edit the report and fix these fields.`);
            this.state = COPILOT_STATES.PREVIEW;
            this.renderPreview();
            return;
        }

        this.state = COPILOT_STATES.SUBMITTING;
        this.showTyping();
        try {
            const response = await fetch(this.intakeUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.issueDraft)
            });

            let data;
            try {
                data = await response.json();
            } catch (_) {
                data = {};
            }

            if (response.ok) {
                this.state = COPILOT_STATES.SUCCESS;
                this.clearDraft();
                this.updateSuggestions();
                this.renderSuccess(data.data);
            } else {
                // Handle specific error codes
                this.state = COPILOT_STATES.PREVIEW;
                if (response.status === 401) {
                    // Token expired — clear stale token and re-trigger auth gate
                    localStorage.removeItem('resolvit_token');
                    this.appendMessage('ai', '⚠️ **Session expired.** Please log in again to submit your report.');
                    this.state = COPILOT_STATES.CONFIRM;
                    this.saveDraft();
                    this.renderAuthGate();
                } else {
                    // Safely parse error — never render raw objects
                    const errMsg = this._parseErrorDetail(data.detail)
                                || data.message
                                || 'Submission failed. Please check the complaint details and try again.';
                    this.appendMessage('ai', `❌ **Submission Error:**\n${errMsg}`);
                    this.saveDraft();
                    this.renderPreview();
                }
            }
        } catch (err) {
            this.state = COPILOT_STATES.PREVIEW;
            this.appendMessage('ai', '⚠️ **Network error.** Your draft is saved. Please check your connection and try again.');
            this.saveDraft();
            this.renderPreview();
        } finally {
            this.removeTyping();
        }
    }

    renderAuthGate() {
        const container = document.createElement('div');
        container.className = 'msg-container msg-ai';
        container.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="msg-bubble auth-gate-card">
                <div style="font-size: 2rem; color: #f59e0b; margin-bottom: 8px;"><i class="fas fa-user-shield"></i></div>
                <h3 style="margin:0 0 8px 0; color:white;">Identity Verification</h3>
                <p style="font-size: 0.85rem; color: #cbd5e1; margin-bottom: 20px;">Your report is ready. <strong>Login required</strong> to submit to the official pipeline.</p>
                <div style="display:flex; gap:10px; width: 100%;">
                    <button class="copilot-card-btn primary" id="copilot-login-btn">Open Login Modal</button>
                </div>
            </div>
        `;
        this.messagesDiv.appendChild(container);

        // Bind login button with copilot-aware flow
        container.querySelector('#copilot-login-btn').addEventListener('click', () => {
            this.saveDraft();
            if (window.Auth && typeof Auth.showModal === 'function') {
                // Set flag so auth.js knows NOT to redirect after login
                Auth._copilotPendingLogin = true;
                Auth.showModal('login');
            } else {
                // Fallback: redirect to login page with returnTo param
                sessionStorage.setItem('copilot_login_pending', 'true');
                window.location.href = 'index.html?returnTo=chatbot-report';
            }
        });

        this.scrollToBottom();
    }

    renderSuccess(issue) {
        this.state = COPILOT_STATES.INIT;
        this.updateSuggestions();
        const container = document.createElement('div');
        container.className = 'msg-container msg-ai';
        container.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="msg-bubble success-card">
                <div class="success-icon"><i class="fas fa-check-circle"></i></div>
                <h3 style="margin:5px 0; color:#10b981;">Report Validated</h3>
                <p style="font-size:0.8rem; margin-bottom:15px;">Your issue is now part of the **${issue.status.toUpperCase()}** cluster.</p>
                
                <div class="success-details">
                    <div class="detail-row"><span>Tracking ID:</span> <strong>${issue.id.slice(0,8)}</strong></div>
                    <div class="detail-row"><span>Priority Score:</span> <strong>${issue.priority_score.toFixed(1)}</strong></div>
                    <div class="detail-row"><span>SLA Duration:</span> <strong>${issue.sla_hours} Hours</strong></div>
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:20px;">
                    <button class="copilot-card-btn" onclick="window.location.href='dashboard.html'">Track Progress</button>
                    <button class="copilot-card-btn" onclick="window.location.href='index.html?open_map=${issue.id}'">View on Map</button>
                </div>
            </div>
        `;
        this.messagesDiv.appendChild(container);
        this.scrollToBottom();
    }

    saveDraft() {
        localStorage.setItem('copilot_draft', JSON.stringify({
            state: this.state,
            draft: this.issueDraft
        }));
    }

    recoverDraft() {
        try {
            const raw = localStorage.getItem('copilot_draft');
            if (raw) {
                const saved = JSON.parse(raw);
                if (saved.state !== COPILOT_STATES.INIT && saved.state !== COPILOT_STATES.SUCCESS) {
                    this.state = saved.state;
                    this.issueDraft = saved.draft;
                    this.appendMessage('ai', "👋 **Welcome back.** I recovered your previous report draft. Shall we continue?");
                    this.renderPreview();
                }
            }
        } catch (e) {}
    }

    clearDraft() {
        localStorage.removeItem('copilot_draft');
    }

    appendMessage(sender, text, sources = []) {
        const container = document.createElement('div');
        container.className = `msg-container msg-${sender}`;

        let innerHTML = '';
        if (sender === 'ai') {
            let ragChips = '';
            if (sources.length > 0) {
                ragChips = '<div class="rag-sources">' + sources.map(src => `<div class="rag-chip"><i class="fas fa-database"></i> ${src}</div>`).join('') + '</div>';
            }

            // Simple Markdown Support
            let parsedHtml = text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/^### (.*)/gm, '<h4>$1</h4>')
                .replace(/^## (.*)/gm, '<h3>$1</h3>')
                .replace(/^# (.*)/gm, '<h2>$1</h2>')
                .replace(/\n\n/g, '<br>')
                .replace(/\n/g, '<br>');

            innerHTML = `
                <div class="ai-avatar"><i class="fas fa-robot"></i></div>
                ${ragChips}
                <div class="msg-bubble">${parsedHtml}</div>
            `;
        } else {
            innerHTML = `<div class="msg-bubble"><p>${text}</p></div>`;
        }

        container.innerHTML = innerHTML;
        this.messagesDiv.appendChild(container);
        this.scrollToBottom();
    }

    showTyping() {
        this.isTyping = true;
        const container = document.createElement('div');
        container.className = `msg-container msg-ai`;
        container.id = 'typing-indicator-container';
        container.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="msg-bubble typing-bubble">
                <div class="typing-indicator"><span></span><span></span><span></span></div>
            </div>
        `;
        this.messagesDiv.appendChild(container);
        this.scrollToBottom();
    }

    removeTyping() {
        this.isTyping = false;
        const el = document.getElementById('typing-indicator-container');
        if (el) el.remove();
    }

    scrollToBottom() {
        if (!this.messagesDiv) return;
        this.messagesDiv.scrollTo({
            top: this.messagesDiv.scrollHeight,
            behavior: 'smooth'
        });
    }

    async callBackendCopilot() {
        const payload = { messages: this.chatHistory, user_role: this.role };
        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error("API Failure");
        return await response.json();
    }
}

// Global initialization
window.initResolvitCopilot = function (role = 'citizen') {
    if (!window.resolvitCopilotInstance) {
        window.resolvitCopilotInstance = new ResolvitCopilot({ role: role });
    }
};
