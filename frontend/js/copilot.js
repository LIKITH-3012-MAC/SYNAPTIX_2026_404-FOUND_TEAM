/**
 * RESOLVIT AI COPILOT
 * Core Logic Engine - Frontend UI handler pointing to Python Backend
 */

class ResolvitCopilot {
    constructor(config = {}) {
        const baseUrl = window.BASE_URL || '';
        this.apiUrl = baseUrl + '/api/chat';
        this.intakeUrl = baseUrl + '/api/chat/complaint-intake';

        this.role = config.role || 'citizen';
        this.chatHistory = [];
        this.isOpen = false;
        this.isTyping = false;

        this.initDOM();
        this.bindEvents();
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
                            <span class="copilot-status"><div class="copilot-status-dot"></div> Operational • Role: ${this.role.toUpperCase()}</span>
                        </div>
                    </div>
                    <button id="copilot-close" class="copilot-btn" style="color:white;"><i class="fas fa-times"></i></button>
                </div>

                <div id="copilot-messages" class="copilot-messages">
                    <div class="msg-container msg-ai">
                        <div class="ai-avatar"><i class="fas fa-robot"></i></div>
                        <div class="msg-bubble">
                            <p>Hello! I am your <strong>Resolvit AI Copilot</strong>.</p>
                            <p>I can help you report an issue intelligently. What would you like to do?</p>
                        </div>
                    </div>
                </div>

                <div class="copilot-footer">
                    <div id="copilot-suggestions" class="copilot-suggestions">
                        ${this.getSuggestions()}
                    </div>
                    
                    <div class="copilot-input-wrapper">
                        <button class="copilot-btn" title="Attach Document"><i class="fas fa-paperclip"></i></button>
                        <input type="text" id="copilot-input" class="copilot-input" placeholder="Ask Copilot or declare an issue..." autocomplete="off">
                        <button class="copilot-btn" title="Voice Input"><i class="fas fa-microphone"></i></button>
                        <button id="copilot-send" class="copilot-btn copilot-send-btn"><i class="fas fa-paper-plane"></i></button>
                    </div>
                </div>
            </div>
        `;
        // Only inject if it doesn't exist
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

        // Delegate clicks for suggestion chips
        this.suggestContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('copilot-suggestion-chip')) {
                this.input.value = e.target.innerText;
                this.handleSend();
            }
        });
    }

    getSuggestions() {
        if (this.role === 'citizen' || this.role === 'user') {
            return `
                <div class="copilot-suggestion-chip">Raise an issue</div>
                <div class="copilot-suggestion-chip">How do I report a problem?</div>
                <div class="copilot-suggestion-chip">What category fits my issue?</div>
            `;
        }
        return `
            <div class="copilot-suggestion-chip">Summarize urgent cases</div>
            <div class="copilot-suggestion-chip">What supplies should I carry?</div>
        `;
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
        if (!text || this.isTyping) return;

        this.input.value = '';
        this.appendMessage('user', text);
        this.chatHistory.push({ role: "user", content: text });

        this.showTyping();

        try {
            const data = await this.callBackendCopilot();
            this.removeTyping();

            // Append standard AI reply with sources
            this.appendMessage('ai', data.text, data.sources);
            this.chatHistory.push({ role: "assistant", content: data.text });

            // Handle INTENT actions
            if (data.action === "SHOW_INTAKE_FORM") {
                this.handleIntakeIntent();
            }

        } catch (error) {
            console.error("AI Copilot Error:", error);
            this.removeTyping();
            this.appendMessage('ai', "Neural link disconnected. Check connection.");
        }
    }

    handleIntakeIntent() {
        this.renderMiniForm();
    }

    appendMessage(sender, text, sources = []) {
        const container = document.createElement('div');
        container.className = `msg-container msg-${sender}`;

        let innerHTML = '';
        if (sender === 'ai') {
            let ragChips = '';
            if (sources.length > 0) {
                ragChips = '<div class="rag-sources">';
                sources.forEach(src => {
                    ragChips += `<div class="rag-chip"><i class="fas fa-database"></i> ${src}</div>`;
                });
                ragChips += '</div>';
            }

            // Parse Markdown Elements
            let lines = text.split('\n');
            let parsedHtml = '';
            let inList = false;

            for (let line of lines) {
                line = line.trim();
                if (!line) { parsedHtml += '<br>'; continue; }

                // Bold
                line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

                // Headings
                if (line.startsWith('### ')) {
                    line = `<h4>${line.substring(4)}</h4>`;
                } else if (line.startsWith('## ')) {
                    line = `<h3>${line.substring(3)}</h3>`;
                } else if (line.startsWith('# ')) {
                    line = `<h2>${line.substring(2)}</h2>`;
                }
                
                // Lists (Bullet and Numbered)
                if (line.match(/^(\d+\.|-|\*)\s+(.*)/)) {
                    if (!inList) { parsedHtml += '<ul>'; inList = true; }
                    let content = line.replace(/^(\d+\.|-|\*)\s+/, '');
                    parsedHtml += `<li>${content}</li>`;
                } else {
                    if (inList) { parsedHtml += '</ul>'; inList = false; }
                    if (!line.startsWith('<h')) {
                        parsedHtml += `<p>${line}</p>`;
                    } else {
                        parsedHtml += line;
                    }
                }
            }
            if (inList) parsedHtml += '</ul>';

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

    renderAuthGate() {
        const container = document.createElement('div');
        container.className = 'msg-container msg-ai';
        container.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="msg-bubble auth-gate-card">
                <div style="font-size: 2rem; color: #ef4444; margin-bottom: 8px;"><i class="fas fa-lock"></i></div>
                <h3 style="margin:0 0 8px 0; color:white;">Authentication Required</h3>
                <p style="font-size: 0.85rem; color: #cbd5e1; margin-bottom: 20px;">You need to be logged in before submitting a complaint. Please log in first, then continue.</p>
                <div style="display:flex; gap:10px; width: 100%;">
                    <button class="copilot-card-btn primary" onclick="window.location.href='login.html'">Login</button>
                    <button class="copilot-card-btn secondary" onclick="window.location.href='signup.html'">Sign Up</button>
                </div>
            </div>
        `;
        this.messagesDiv.appendChild(container);
        this.scrollToBottom();
    }

    renderMiniForm() {
        const container = document.createElement('div');
        container.className = 'msg-container msg-ai';
        const formId = "copilot-form-" + Date.now();

        // Load preserved draft if any
        let draft = {};
        try {
            const saved = localStorage.getItem('copilot_draft');
            if (saved) draft = JSON.parse(saved);
        } catch(e) {}

        container.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="msg-bubble mini-form-card">
                <div class="mini-form-header">
                    <i class="fas fa-file-signature"></i> 
                    <span>Structured Incident Report</span>
                </div>
                <form id="${formId}" class="copilot-mini-form" onsubmit="event.preventDefault(); window.resolvitCopilotInstance.submitMiniForm('${formId}')">
                    <div class="form-group">
                        <label>Issue Title</label>
                        <input type="text" name="title" required placeholder="E.g., Pothole on High Street" value="${draft.title || ''}">
                    </div>
                    <div class="form-group">
                        <label>Category</label>
                        <select name="category" required>
                            <option value="">Select Category...</option>
                            <option value="roads" ${draft.category==='roads'?'selected':''}>Roads & Infrastructure</option>
                            <option value="sanitation" ${draft.category==='sanitation'?'selected':''}>Sanitation</option>
                            <option value="water" ${draft.category==='water'?'selected':''}>Water Supply</option>
                            <option value="safety" ${draft.category==='safety'?'selected':''}>Public Safety</option>
                            <option value="other" ${draft.category==='other'?'selected':''}>Other</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Location (Area/Landmark)</label>
                        <input type="text" name="location" required placeholder="Enter precise location..." value="${draft.location || ''}">
                    </div>
                    <div class="form-group">
                        <label>Description</label>
                        <textarea name="description" required placeholder="Provide details...">${draft.description || ''}</textarea>
                    </div>
                    <div style="display:flex; gap:12px;">
                        <div class="form-group" style="flex:1;">
                            <label>Severity (1-5)</label>
                            <input type="number" name="urgency" min="1" max="5" value="${draft.urgency || 3}" required>
                        </div>
                        <div class="form-group" style="flex:1;">
                            <label>People Affected</label>
                            <input type="number" name="impact_scale" placeholder="Optional" value="${draft.impact_scale || ''}">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Photo Evidence (Optional URL)</label>
                        <input type="text" name="image_url" placeholder="https://..." value="${draft.image_url || ''}">
                    </div>
                    <div style="margin-top:16px;">
                        <button type="submit" class="copilot-submit-btn">Submit to Blockchain Audit Trail</button>
                    </div>
                </form>
            </div>
        `;
        this.messagesDiv.appendChild(container);
        this.scrollToBottom();
    }

    async submitMiniForm(formId) {
        const formEl = document.getElementById(formId);
        if (!formEl) return;

        const formData = new FormData(formEl);
        
        const token = localStorage.getItem('resolvit_token') || localStorage.getItem('token');
        if (!token) {
            // Preserve drafting state locally
            const draftObj = Object.fromEntries(formData.entries());
            localStorage.setItem('copilot_draft', JSON.stringify(draftObj));
            
            // Show Elite Auth gate
            this.renderAuthGate();
            return;
        }

        const payload = {
            title: formData.get('title'),
            category: formData.get('category'),
            description: formData.get('description'),
            urgency: parseInt(formData.get('urgency')) || 3,
            impact_scale: parseInt(formData.get('impact_scale')) || 2, 
            safety_risk_probability: 0.1, 
            location: formData.get('location'),
            image_url: formData.get('image_url')
        };

        // Clear preserved draft upon proceeding with submission
        localStorage.removeItem('copilot_draft');

        formEl.innerHTML = '<div style="color:#10b981; font-weight:bold; text-align:center;"><i class="fas fa-spinner fa-spin"></i> Submitting to backend...</div>';

        try {
            const response = await fetch(this.intakeUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (response.ok) {
                formEl.innerHTML = `<div style="color:#a5b4fc; font-weight:bold; text-align:center;"><i class="fas fa-check-circle"></i> Issue Logged Successfully! Tracking ID: ${data.data.id}</div>`;
                this.appendMessage('ai', `Your issue has been successfully routed to the authorities with Priority Score: **${data.data.priority_score.toFixed(1)}**! You can track this in your dashboard.`);
            } else {
                formEl.innerHTML = `<div style="color:#f87171; text-align:center;">Failed: ${data.detail || 'Unknown error'}</div>`;
            }

        } catch (err) {
            formEl.innerHTML = `<div style="color:#f87171; text-align:center;">Network error.</div>`;
        }
    }

    showTyping() {
        this.isTyping = true;
        const container = document.createElement('div');
        container.className = `msg-container msg-ai`;
        container.id = 'typing-indicator-container';
        container.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="msg-bubble">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
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

    scrollToBottom(force = false) {
        if (!this.messagesDiv) return;

        // Intelligent Auto-scroll calculation
        // Check if the user is currently at or near the bottom (within ~150px)
        const isNearBottom = this.messagesDiv.scrollHeight - this.messagesDiv.scrollTop - this.messagesDiv.clientHeight < 150;
        
        if (force || isNearBottom) {
            this.messagesDiv.scrollTo({
                top: this.messagesDiv.scrollHeight,
                behavior: 'smooth'
            });
        }
    }

    async callBackendCopilot() {
        const payload = {
            messages: this.chatHistory,
            user_role: this.role
        };

        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data; // { text: "...", action: "...", sources: [...] }
    }
}

// Global initialization explicitly attached to window
window.initResolvitCopilot = function (role = 'citizen') {
    if (!window.resolvitCopilotInstance) {
        window.resolvitCopilotInstance = new ResolvitCopilot({ role: role });
    }
};
