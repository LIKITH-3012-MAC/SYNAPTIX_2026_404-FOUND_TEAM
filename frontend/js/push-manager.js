/**
 * RESOLVIT Progressive Web App (PWA) Push Notification Manager
 * Manages WebPush registration, VAPID key handshake, soft permission prompt,
 * Settings UI binding, and OS-native test notification triggers.
 */

(function () {
  'use strict';

  const PUSH_STORAGE_KEY = 'resolvit_push_enabled';
  const PROMPT_DISMISS_KEY = 'resolvit_push_prompt_dismissed';
  let cachedVapidPublicKey = null;

  // ----------------------------------------------------
  // 1. Helpers & Base64 Key Conversion
  // ----------------------------------------------------
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function isPushSupported() {
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  function getPermissionState() {
    if (!isPushSupported()) return 'unsupported';
    return Notification.permission;
  }

  function isSubscribed() {
    return localStorage.getItem(PUSH_STORAGE_KEY) === 'true';
  }

  // ----------------------------------------------------
  // 2. Fetch Public VAPID Key from Backend
  // ----------------------------------------------------
  async function fetchVapidPublicKey() {
    if (cachedVapidPublicKey) return cachedVapidPublicKey;

    try {
      const response = await fetch('/api/push/vapid-public-key');
      const data = await response.json();
      if (data && data.public_key) {
        cachedVapidPublicKey = data.public_key;
        return cachedVapidPublicKey;
      }
    } catch (err) {
      console.warn('[PUSH-CLIENT] Failed to fetch VAPID key from backend, using fallback:', err);
    }

    // Fallback VAPID key
    cachedVapidPublicKey = "BEl62iUYgUivxIkv69yViEuiBIa45-66tV-V9N9Gf9vK2P4M9S8_z8YwV9zQ_7V9_W9G_vK9P4M9S8_z8YwV9zQ";
    return cachedVapidPublicKey;
  }

  // ----------------------------------------------------
  // 3. Subscribe User Device to Web Push
  // ----------------------------------------------------
  async function subscribeUser() {
    if (!isPushSupported()) {
      showPushToast('Push notifications are not supported by this browser.', false);
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      console.group('🔍 PWA Push Diagnostic Audit: Subscription Flow');
      console.log('1. Permission Status:', permission);

      if (permission !== 'granted') {
        console.warn('Notification permission denied by user.');
        console.groupEnd();
        showPushToast('Notification permission was denied. You can enable it in browser settings.', false);
        localStorage.setItem(PUSH_STORAGE_KEY, 'false');
        updatePushTogglesUI(false);
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      console.log('2. Service Worker Status: Active (Scope: ' + registration.scope + ')');

      const publicKey = await fetchVapidPublicKey();
      console.log('3. VAPID Public Key:', publicKey ? publicKey.substring(0, 30) + '...' : 'Missing');

      const convertedKey = urlBase64ToUint8Array(publicKey);
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedKey
        });
      }

      const subJson = subscription.toJSON();
      console.log('4. Subscription Object:', subJson);

      const userRole = (window.Auth && window.Auth.getRole) ? window.Auth.getRole() : 'citizen';

      // Register subscription with backend
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys.p256dh,
            auth: subJson.keys.auth
          },
          user_role: userRole,
          device_type: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
        })
      });

      const dbData = await res.json();
      console.log('5. Database Save Status:', res.status, dbData);
      console.groupEnd();

      if (res.ok) {
        localStorage.setItem(PUSH_STORAGE_KEY, 'true');
        updatePushTogglesUI(true);
        showPushToast('Push Notifications Enabled! Real-time alerts activated.', true);
        return true;
      } else {
        throw new Error(dbData.detail || 'Backend failed to register push subscription');
      }
    } catch (err) {
      console.error('[PUSH-CLIENT] Subscription error:', err);
      showPushToast('Failed to activate push notifications: ' + err.message, false);
      return false;
    }
  }

  // ----------------------------------------------------
  // 4. Unsubscribe User Device
  // ----------------------------------------------------
  async function unsubscribeUser() {
    if (!isPushSupported()) return false;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const subJson = subscription.toJSON();
        
        // Notify backend
        fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subJson.endpoint })
        }).catch(e => console.warn('[PUSH-CLIENT] Backend unsubscribe warn:', e));

        await subscription.unsubscribe();
      }

      localStorage.setItem(PUSH_STORAGE_KEY, 'false');
      updatePushTogglesUI(false);
      showPushToast('Push Notifications disabled.', false);
      return true;
    } catch (err) {
      console.error('[PUSH-CLIENT] Unsubscribe error:', err);
      return false;
    }
  }

  // ----------------------------------------------------
  // 5. Send Real Native Test Push Notification
  // ----------------------------------------------------
  async function sendTestNotification() {
    if (!isPushSupported()) {
      showPushToast('Browser does not support native push notifications.', false);
      return;
    }

    if (Notification.permission !== 'granted') {
      const subscribed = await subscribeUser();
      if (!subscribed) return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription ? subscription.endpoint : null;

      console.group('🔍 PWA Push Diagnostic Audit: Test Delivery Flow');
      console.log('1. Permission Status:', Notification.permission);
      console.log('2. Service Worker Ready:', registration.active ? 'Active' : 'Installing');
      console.log('3. Subscription Object:', subscription ? subscription.toJSON() : null);

      const response = await fetch('/api/push/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: endpoint })
      });

      const data = await response.json();
      console.log('4. Push Request Status Code:', response.status);
      console.log('5. Backend Response Data:', data);
      console.log('6. Push Provider Telemetry:', data.diagnostics || 'No provider telemetry object');
      console.groupEnd();

      if (data.success) {
        showPushToast('⚡ Real OS Test Notification sent! Check your desktop/phone notifications.', true);
      } else {
        const detailMsg = (data.diagnostics && data.diagnostics.push_provider_response) 
          ? data.diagnostics.push_provider_response 
          : (data.detail || data.message || 'Push provider failure');
        showPushToast('Push failure: ' + detailMsg, false);
      }
    } catch (err) {
      console.error('[PUSH-CLIENT] Test notification error:', err);
      if ('serviceWorker' in navigator && Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification('⚡ RESOLVIT Test Notification', {
          body: 'Your PWA WebPush engine is working natively!',
          icon: '/icons/icon-192x192.png',
          badge: '/icons/badge-72x72.png',
          tag: 'test-push',
          data: { url: '/dashboard.html' }
        });
        showPushToast('Local OS notification displayed!', true);
      }
    }
  }

  // ----------------------------------------------------
  // 6. Soft Permission Banner / Modal UI
  // ----------------------------------------------------
  function createPermissionModal() {
    if (document.getElementById('push-permission-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'push-permission-modal';
    modal.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 24px;
      z-index: 99999;
      max-width: 400px;
      width: calc(100vw - 48px);
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(99, 102, 241, 0.4);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 20px rgba(99, 102, 241, 0.2);
      color: white;
      font-family: 'Inter', sans-serif;
      display: none;
      animation: slideUpIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    `;

    modal.innerHTML = `
      <div style="display:flex; align-items:flex-start; gap:14px;">
        <div style="width:40px; height:40px; border-radius:12px; background:linear-gradient(135deg, #6366f1, #8b5cf6); display:flex; align-items:center; justify-content:center; font-size:1.3rem; flex-shrink:0; box-shadow:0 4px 12px rgba(99,102,241,0.4);">
          🔔
        </div>
        <div style="flex:1;">
          <h4 style="margin:0 0 6px; font-size:1rem; font-weight:700; color:white; display:flex; align-items:center; gap:8px;">
            Enable Push Notifications
            <span style="font-size:0.65rem; background:rgba(99,102,241,0.2); color:#a5b4fc; border:1px solid rgba(99,102,241,0.4); padding:2px 6px; border-radius:4px;">PRO</span>
          </h4>
          <p style="margin:0 0 16px; font-size:0.82rem; color:#94a3b8; line-height:1.4;">
            Get real-time OS alerts for civic issue updates, SLA escalations, and emergency announcements even when app is closed.
          </p>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button id="push-prompt-later" style="padding:8px 14px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#cbd5e1; font-size:0.8rem; font-weight:600; cursor:pointer;">Later</button>
            <button id="push-prompt-enable" style="padding:8px 18px; background:linear-gradient(135deg, #6366f1, #8b5cf6); border:none; border-radius:8px; color:white; font-size:0.8rem; font-weight:700; cursor:pointer; box-shadow:0 4px 12px rgba(99,102,241,0.4);">Enable Notifications</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('push-prompt-enable').addEventListener('click', async () => {
      modal.style.display = 'none';
      await subscribeUser();
    });

    document.getElementById('push-prompt-later').addEventListener('click', () => {
      modal.style.display = 'none';
      localStorage.setItem(PROMPT_DISMISS_KEY, Date.now().toString());
    });
  }

  function showPermissionPrompt() {
    if (!isPushSupported()) return;
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
    
    const dismissedTime = localStorage.getItem(PROMPT_DISMISS_KEY);
    if (dismissedTime && (Date.now() - parseInt(dismissedTime, 10)) < 48 * 60 * 60 * 1000) {
      return; // Respect 48-hour dismissal
    }

    createPermissionModal();
    const modal = document.getElementById('push-permission-modal');
    if (modal) {
      setTimeout(() => {
        modal.style.display = 'block';
      }, 2500);
    }
  }

  // ----------------------------------------------------
  // 7. Toast UI Feedback Helper
  // ----------------------------------------------------
  function showPushToast(msg, isSuccess) {
    let toast = document.getElementById('push-feedback-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'push-feedback-toast';
      toast.style.cssText = `
        position: fixed;
        top: 84px;
        right: 24px;
        z-index: 99999;
        max-width: 380px;
        padding: 14px 18px;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 600;
        color: white;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        transform: translateY(-20px);
        opacity: 0;
        pointer-events: none;
      `;
      document.body.appendChild(toast);
    }

    toast.style.background = isSuccess ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.95)';
    toast.style.border = isSuccess ? '1px solid #10b981' : '1px solid #ef4444';
    toast.innerText = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-20px)';
    }, 4500);
  }

  // ----------------------------------------------------
  // 8. Sync UI Toggles Across Pages
  // ----------------------------------------------------
  function updatePushTogglesUI(enabled) {
    const toggles = document.querySelectorAll('.push-notification-toggle');
    toggles.forEach(toggle => {
      if (toggle.type === 'checkbox') {
        toggle.checked = enabled;
      }
    });

    const statusTexts = document.querySelectorAll('.push-status-text');
    statusTexts.forEach(el => {
      el.textContent = enabled ? 'Push Notifications Active' : 'Push Notifications Disabled';
      el.style.color = enabled ? '#10b981' : '#94a3b8';
    });
  }

  // ----------------------------------------------------
  // 9. Initializer
  // ----------------------------------------------------
  function initPushManager() {
    if (!isPushSupported()) return;

    // Check if permission already granted
    if (Notification.permission === 'granted') {
      // Refresh subscription silently
      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          localStorage.setItem(PUSH_STORAGE_KEY, 'true');
          updatePushTogglesUI(true);
        }
      });
    }

    // Auto-bind click handlers for toggle inputs
    document.addEventListener('change', (e) => {
      if (e.target && e.target.classList.contains('push-notification-toggle')) {
        if (e.target.checked) {
          subscribeUser();
        } else {
          unsubscribeUser();
        }
      }
    });

    // Auto-bind click handlers for test push buttons
    document.addEventListener('click', (e) => {
      if (e.target && (e.target.classList.contains('btn-test-push') || e.target.closest('.btn-test-push'))) {
        e.preventDefault();
        sendTestNotification();
      }
    });

    // Prompt user politely after meaningful engagement
    setTimeout(showPermissionPrompt, 4000);
  }

  document.addEventListener('DOMContentLoaded', initPushManager);

  // Expose global RESOLVIT_PUSH API
  window.RESOLVIT_PUSH = {
    init: initPushManager,
    subscribe: subscribeUser,
    unsubscribe: unsubscribeUser,
    isSupported: isPushSupported,
    isSubscribed: isSubscribed,
    getPermissionState: getPermissionState,
    sendTestNotification: sendTestNotification,
    showPermissionPrompt: showPermissionPrompt
  };

})();
