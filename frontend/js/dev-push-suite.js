/**
 * RESOLVIT / Prometheus AI — Development Push Notification Test Suite
 * Interactive testing suite for verifying real operating system Web Push notifications,
 * Service Worker event dispatching, and deep link navigation across viewports.
 * 
 * Automatically active in development environments (localhost, 127.0.0.1, or resolvit_dev_mode=true).
 */

(function () {
  'use strict';

  // ----------------------------------------------------
  // 1. Environment Guard (Auto-disabled in Production)
  // ----------------------------------------------------
  function isDevEnvironment() {
    const host = window.location.hostname;
    const urlParams = new URLSearchParams(window.location.search);
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('192.168.') ||
      host.endsWith('.local') ||
      urlParams.get('dev') === '1' ||
      localStorage.getItem('resolvit_dev_mode') === 'true'
    );
  }

  // ----------------------------------------------------
  // 2. Sample Notification Templates (10 Core Scenarios)
  // ----------------------------------------------------
  const SAMPLE_TEMPLATES = {
    welcome: {
      id: 'welcome',
      title: '👋 Welcome to Prometheus AI',
      body: 'Thanks for installing the application. Explore all AI tools.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      category: 'welcome',
      priority: 'normal',
      url: '/index.html'
    },
    ai_completed: {
      id: 'ai_completed',
      title: '✅ AI Task Completed',
      body: 'Your AI request has finished successfully.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      category: 'ai_task',
      priority: 'high',
      url: '/intelligence.html'
    },
    admin_announcement: {
      id: 'admin_announcement',
      title: '📢 New Announcement',
      body: 'The administrator has published an important update.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      category: 'announcement',
      priority: 'normal',
      url: '/dashboard.html'
    },
    new_feature: {
      id: 'new_feature',
      title: '🚀 New Feature Available',
      body: 'A new AI feature has been added. Tap to explore.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      category: 'feature',
      priority: 'normal',
      url: '/care.html'
    },
    security_alert: {
      id: 'security_alert',
      title: '🔒 Security Alert',
      body: 'A new login was detected on your account.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      category: 'security',
      priority: 'high',
      url: '/citizen.html'
    },
    sync_complete: {
      id: 'sync_complete',
      title: '🔄 Sync Complete',
      body: 'Offline data has been synchronized successfully.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      category: 'sync',
      priority: 'normal',
      url: '/dashboard.html'
    },
    internet_restored: {
      id: 'internet_restored',
      title: '🌐 Connection Restored',
      body: 'Your device is back online. Pending requests are syncing.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      category: 'network',
      priority: 'normal',
      url: '/dashboard.html'
    },
    reminder: {
      id: 'reminder',
      title: '⏰ Friendly Reminder',
      body: 'Continue where you left off.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      category: 'reminder',
      priority: 'normal',
      url: '/authority.html'
    },
    ai_message: {
      id: 'ai_message',
      title: '🤖 Prometheus AI',
      body: 'Your AI assistant has a new response waiting.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      category: 'message',
      priority: 'high',
      url: '/index.html'
    },
    maintenance: {
      id: 'maintenance',
      title: '🛠 Scheduled Maintenance',
      body: 'Maintenance will begin at 10:00 PM tonight.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      category: 'maintenance',
      priority: 'normal',
      url: '/index.html'
    }
  };

  // ----------------------------------------------------
  // 3. Notification Dispatcher Core
  // ----------------------------------------------------
  async function triggerNotification(template) {
    if (!('Notification' in window)) {
      showDevToast('Notifications API not supported by browser', false);
      return false;
    }

    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showDevToast('Notification permission denied by user', false);
        return false;
      }
    }

    const payloadOptions = {
      body: template.body,
      icon: template.icon || '/icons/icon-192x192.png',
      badge: template.badge || '/icons/icon-192x192.png',
      image: template.image || undefined,
      tag: 'dev-suite-' + (template.id || 'custom') + '-' + Date.now(),
      timestamp: Date.now(),
      vibrate: [100, 50, 100, 50, 100],
      requireInteraction: template.priority === 'high',
      data: {
        url: template.url || '/',
        category: template.category || 'test'
      },
      actions: [
        { action: 'open', title: 'Open Page' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    };

    try {
      // 1. Try Service Worker registration showNotification (Real PWA Background Push path)
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(template.title, payloadOptions);
          showDevToast(`Triggered OS Notification: ${template.title}`, true);
          return true;
        }
      }

      // 2. Fallback to native window Notification constructor
      const notif = new Notification(template.title, payloadOptions);
      notif.onclick = function () {
        window.focus();
        if (template.url) window.location.href = template.url;
        notif.close();
      };

      showDevToast(`Triggered OS Notification: ${template.title}`, true);
      return true;
    } catch (err) {
      console.error('[DEV-PUSH-SUITE] Dispatch error:', err);
      showDevToast('Notification error: ' + err.message, false);
      return false;
    }
  }

  // ----------------------------------------------------
  // 4. Sequential Broadcast Test ("Send All Notifications")
  // ----------------------------------------------------
  async function triggerAllNotifications() {
    const keys = Object.keys(SAMPLE_TEMPLATES);
    showDevToast(`Starting sequential test of ${keys.length} notifications...`, true);

    for (let i = 0; i < keys.length; i++) {
      const template = SAMPLE_TEMPLATES[keys[i]];
      await triggerNotification(template);
      await new Promise(resolve => setTimeout(resolve, 1200));
    }

    showDevToast('Completed all 10 notification tests!', true);
  }

  // ----------------------------------------------------
  // 5. Toast Feedback Helper
  // ----------------------------------------------------
  function showDevToast(msg, isSuccess) {
    let toast = document.getElementById('dev-push-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'dev-push-toast';
      toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(-20px);
        z-index: 100000;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(12px);
        border: 1px solid ${isSuccess ? '#10b981' : '#ef4444'};
        color: white;
        padding: 10px 18px;
        border-radius: 999px;
        font-size: 0.82rem;
        font-weight: 600;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        opacity: 0;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: 'Inter', sans-serif;
      `;
      document.body.appendChild(toast);
    }

    toast.style.border = `1px solid ${isSuccess ? '#10b981' : '#ef4444'}`;
    toast.innerHTML = isSuccess ? `<span>✅ ${msg}</span>` : `<span>⚠️ ${msg}</span>`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-20px)';
    }, 3000);
  }

  // ----------------------------------------------------
  // 6. Developer Notification Testing Panel UI
  // ----------------------------------------------------
  function createDevPanelUI() {
    if (document.getElementById('dev-push-panel-container')) return;

    // Trigger Button (Bottom Left Floating Badge)
    const triggerBtn = document.createElement('button');
    triggerBtn.id = 'dev-push-trigger-badge';
    triggerBtn.setAttribute('title', 'Developer Push Notification Test Suite (Shift+Alt+N)');
    triggerBtn.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      z-index: 99990;
      background: linear-gradient(135deg, #0f172a, #1e1b4b);
      border: 1px solid rgba(139, 92, 246, 0.5);
      color: #c4b5fd;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 0 12px rgba(139, 92, 246, 0.3);
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: 'Inter', sans-serif;
      transition: transform 0.2s, box-shadow 0.2s;
    `;
    triggerBtn.innerHTML = `<span>⚡ Dev Push Suite</span> <span style="font-size:0.65rem; background:rgba(139, 92, 246, 0.2); padding:1px 5px; border-radius:4px;">DEV</span>`;
    
    triggerBtn.addEventListener('mouseenter', () => triggerBtn.style.transform = 'scale(1.05)');
    triggerBtn.addEventListener('mouseleave', () => triggerBtn.style.transform = 'scale(1)');
    triggerBtn.addEventListener('click', toggleDevPanel);
    document.body.appendChild(triggerBtn);

    // Main Drawer / Panel Container
    const panel = document.createElement('div');
    panel.id = 'dev-push-panel-container';
    panel.style.cssText = `
      position: fixed;
      bottom: 70px;
      left: 20px;
      z-index: 99995;
      width: 380px;
      max-width: calc(100vw - 40px);
      max-height: 80vh;
      overflow-y: auto;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(139, 92, 246, 0.4);
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(139, 92, 246, 0.2);
      color: white;
      font-family: 'Inter', sans-serif;
      display: none;
      animation: devPanelIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    `;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:12px;">
        <div>
          <h3 style="margin:0; font-size:1rem; font-weight:800; color:white; display:flex; align-items:center; gap:6px;">
            ⚡ Push Notification Test Suite
          </h3>
          <p style="margin:2px 0 0; font-size:0.75rem; color:#94a3b8;">Testing OS native push notifications (Dev Only)</p>
        </div>
        <button id="dev-panel-close" style="background:none; border:none; color:#64748b; font-size:1.2rem; cursor:pointer; padding:4px;">✕</button>
      </div>

      <!-- Quick Action Buttons -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px;">
        <button class="dev-btn-action" id="btn-trigger-all" style="grid-column: 1 / -1; background:linear-gradient(135deg, #6366f1, #8b5cf6); color:white; border:none; padding:10px; border-radius:10px; font-size:0.82rem; font-weight:700; cursor:pointer; box-shadow:0 4px 14px rgba(99,102,241,0.4);">
          🚀 Send All 10 Notifications (Sequential)
        </button>
      </div>

      <!-- Template Trigger Buttons Grid -->
      <div style="font-size:0.72rem; font-weight:700; text-transform:uppercase; color:#818cf8; letter-spacing:0.05em; margin-bottom:10px;">Sample Notification Templates</div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:20px;">
        <button class="dev-btn-tpl" data-tpl="welcome">👋 Welcome</button>
        <button class="dev-btn-tpl" data-tpl="ai_completed">✅ AI Task Done</button>
        <button class="dev-btn-tpl" data-tpl="admin_announcement">📢 Announcement</button>
        <button class="dev-btn-tpl" data-tpl="new_feature">🚀 New Feature</button>
        <button class="dev-btn-tpl" data-tpl="security_alert">🔒 Security Alert</button>
        <button class="dev-btn-tpl" data-tpl="sync_complete">🔄 Sync Complete</button>
        <button class="dev-btn-tpl" data-tpl="internet_restored">🌐 Connection OK</button>
        <button class="dev-btn-tpl" data-tpl="reminder">⏰ Reminder</button>
        <button class="dev-btn-tpl" data-tpl="ai_message">🤖 AI Message</button>
        <button class="dev-btn-tpl" data-tpl="maintenance">🛠 Maintenance</button>
      </div>

      <!-- Custom Notification Form -->
      <div style="font-size:0.72rem; font-weight:700; text-transform:uppercase; color:#818cf8; letter-spacing:0.05em; margin-bottom:10px;">Send Custom Test Notification</div>
      
      <form id="dev-custom-form" style="display:flex; flex-direction:column; gap:8px;">
        <input type="text" id="dev-custom-title" placeholder="Custom Title..." value="🧪 Custom Dev Test Notification" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:white; border-radius:8px; padding:8px 10px; font-size:0.8rem; outline:none;">
        <textarea id="dev-custom-body" placeholder="Custom Body message..." style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:white; border-radius:8px; padding:8px 10px; font-size:0.8rem; min-height:50px; outline:none; resize:vertical;">Custom notification dispatched from local developer suite.</textarea>
        <div style="display:flex; gap:8px;">
          <input type="text" id="dev-custom-url" placeholder="Target URL..." value="/dashboard.html" style="flex:1; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:white; border-radius:8px; padding:8px 10px; font-size:0.75rem; outline:none;">
          <button type="submit" style="background:rgba(16,185,129,0.2); border:1px solid #10b981; color:#34d399; font-weight:700; font-size:0.78rem; border-radius:8px; padding:8px 14px; cursor:pointer;">Send Custom</button>
        </div>
      </form>
      
      <div style="margin-top:16px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.06); font-size:0.68rem; color:#64748b; text-align:center;">
        Auto-disabled on production domains. Press <strong>Shift + Alt + N</strong> to toggle anywhere.
      </div>
    `;

    // Add CSS styles for buttons inside dev panel
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
      .dev-btn-tpl {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #e2e8f0;
        padding: 8px 10px;
        border-radius: 8px;
        font-size: 0.78rem;
        font-weight: 600;
        cursor: pointer;
        text-align: left;
        transition: all 0.2s;
      }
      .dev-btn-tpl:hover {
        background: rgba(139, 92, 246, 0.15);
        border-color: #8b5cf6;
        color: white;
        transform: translateY(-1px);
      }
    `;
    document.head.appendChild(styleEl);

    document.body.appendChild(panel);

    // Event Listeners
    document.getElementById('dev-panel-close').addEventListener('click', toggleDevPanel);
    document.getElementById('btn-trigger-all').addEventListener('click', triggerAllNotifications);

    document.querySelectorAll('.dev-btn-tpl').forEach(btn => {
      btn.addEventListener('click', () => {
        const tplKey = btn.getAttribute('data-tpl');
        const tpl = SAMPLE_TEMPLATES[tplKey];
        if (tpl) triggerNotification(tpl);
      });
    });

    document.getElementById('dev-custom-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('dev-custom-title').value.trim() || 'Custom Test';
      const body = document.getElementById('dev-custom-body').value.trim() || 'Custom Message';
      const url = document.getElementById('dev-custom-url').value.trim() || '/';

      triggerNotification({
        id: 'custom_' + Date.now(),
        title: title,
        body: body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        url: url,
        category: 'custom',
        priority: 'normal'
      });
    });

    // Keyboard shortcut (Shift + Alt + N)
    window.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.altKey && (e.key === 'N' || e.key === 'n')) {
        toggleDevPanel();
      }
    });
  }

  function toggleDevPanel() {
    const panel = document.getElementById('dev-push-panel-container');
    if (!panel) return;
    if (panel.style.display === 'none' || !panel.style.display) {
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
    }
  }

  // ----------------------------------------------------
  // 7. Initializer
  // ----------------------------------------------------
  function initDevSuite() {
    if (!isDevEnvironment()) {
      console.log('[DEV-PUSH-SUITE] Production environment detected — Dev Suite disabled.');
      return;
    }

    createDevPanelUI();
    console.log('[DEV-PUSH-SUITE] Developer Push Notification Test Suite active. Press Shift+Alt+N to toggle UI.');
  }

  document.addEventListener('DOMContentLoaded', initDevSuite);

  // Expose global API for console testing
  window.RESOLVIT_DEV_PUSH = {
    templates: SAMPLE_TEMPLATES,
    trigger: triggerNotification,
    triggerAll: triggerAllNotifications,
    toggleUI: toggleDevPanel,
    isDevEnv: isDevEnvironment
  };

})();
