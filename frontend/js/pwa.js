/**
 * RESOLVIT Progressive Web App (PWA) Client Controller
 * Manages Service Worker lifecycle, install prompts, standalone detection, and network status.
 */

(function () {
  'use strict';

  let deferredPrompt = null;
  const INSTALL_KEY = 'resolvit_pwa_installed';
  const DISMISS_KEY = 'resolvit_pwa_dismissed_time';
  const DISMISS_DURATION = 24 * 60 * 60 * 1000; // 24 hours dismissal memory

  // ----------------------------------------------------
  // 1. Standalone & Installation State Queries
  // ----------------------------------------------------
  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  function isInstalled() {
    return isStandalone() || localStorage.getItem(INSTALL_KEY) === 'true';
  }

  function isDismissedRecently() {
    const dismissedTime = localStorage.getItem(DISMISS_KEY);
    if (!dismissedTime) return false;
    const elapsed = Date.now() - parseInt(dismissedTime, 10);
    return elapsed < DISMISS_DURATION;
  }

  function isIOS() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !window.MSStream &&
      !window.navigator.standalone
    );
  }

  // ----------------------------------------------------
  // 2. Service Worker Registration
  // ----------------------------------------------------
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/' })
          .then((reg) => {
            console.log('[PWA] Service Worker registered with scope:', reg.scope);

            reg.onupdatefound = () => {
              const installingWorker = reg.installing;
              if (installingWorker) {
                installingWorker.onstatechange = () => {
                  if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('[PWA] New content available; please refresh.');
                  }
                };
              }
            };
          })
          .catch((err) => {
            console.error('[PWA] Service Worker registration failed:', err);
          });
      });
    }
  }

  // ----------------------------------------------------
  // 3. Network Status Toasts
  // ----------------------------------------------------
  function initNetworkStatusListeners() {
    let toast = document.getElementById('pwa-network-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pwa-network-toast';
      document.body.appendChild(toast);
    }

    let toastTimer = null;

    function showNetworkToast(message, isOnline) {
      if (!toast) return;
      toast.className = isOnline ? 'toast-online toast-show' : 'toast-offline toast-show';
      toast.innerHTML = isOnline
        ? `<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> <span>${message}</span>`
        : `<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg> <span>${message}</span>`;

      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove('toast-show');
      }, 4000);
    }

    window.addEventListener('online', () => showNetworkToast('Back online! Syncing data...', true));
    window.addEventListener('offline', () => showNetworkToast('Working offline', false));
  }

  // ----------------------------------------------------
  // 4. Install Banner UI Management
  // ----------------------------------------------------
  function createInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Install RESOLVIT App');

    banner.innerHTML = `
      <div class="pwa-banner-content">
        <img src="icons/icon-192x192.png" alt="RESOLVIT App Icon" class="pwa-app-icon" />
        <div class="pwa-banner-text">
          <h4 class="pwa-banner-title">
            Install RESOLVIT
            <span class="pwa-banner-badge">PWA</span>
          </h4>
          <p class="pwa-banner-desc">Instant access, notifications & offline civic tools.</p>
        </div>
        <button class="pwa-banner-close" id="pwa-close-btn" aria-label="Close install prompt">
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
      <div class="pwa-banner-actions">
        <button class="pwa-btn-dismiss" id="pwa-dismiss-btn">Not Now</button>
        <button class="pwa-btn-install" id="pwa-action-install">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
          Install App
        </button>
      </div>
    `;

    document.body.appendChild(banner);

    // Event listeners
    document.getElementById('pwa-action-install').addEventListener('click', triggerInstallPrompt);
    document.getElementById('pwa-dismiss-btn').addEventListener('click', dismissInstallBanner);
    document.getElementById('pwa-close-btn').addEventListener('click', dismissInstallBanner);
  }

  function showInstallBanner() {
    if (isInstalled()) return;
    createInstallBanner();
    const banner = document.getElementById('pwa-install-banner');
    if (banner && !isDismissedRecently()) {
      setTimeout(() => {
        banner.classList.add('pwa-banner-visible');
      }, 1500);
    }
  }

  function hideInstallBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) {
      banner.classList.remove('pwa-banner-visible');
    }
  }

  function dismissInstallBanner() {
    hideInstallBanner();
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
  }

  async function triggerInstallPrompt() {
    if (deferredPrompt) {
      hideInstallBanner();
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        console.log('[PWA] User accepted the install prompt');
        localStorage.setItem(INSTALL_KEY, 'true');
      } else {
        console.log('[PWA] User dismissed the install prompt');
        localStorage.setItem(DISMISS_KEY, Date.now().toString());
      }
      deferredPrompt = null;
    } else if (isIOS()) {
      showIOSModal();
    }
  }

  // ----------------------------------------------------
  // 5. iOS Instructions Sheet
  // ----------------------------------------------------
  function createIOSModal() {
    if (document.getElementById('pwa-ios-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'pwa-ios-modal';
    modal.innerHTML = `
      <div class="pwa-ios-card">
        <div class="pwa-ios-header">
          <h3 class="pwa-ios-title">Install RESOLVIT on iPhone</h3>
          <button class="pwa-banner-close" id="pwa-ios-close">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
        <div class="pwa-ios-step">
          <span class="pwa-ios-num">1</span>
          <span>Tap the <strong>Share</strong> icon in Safari bottom bar.</span>
        </div>
        <div class="pwa-ios-step">
          <span class="pwa-ios-num">2</span>
          <span>Scroll down and select <strong>Add to Home Screen</strong>.</span>
        </div>
        <div class="pwa-ios-step">
          <span class="pwa-ios-num">3</span>
          <span>Tap <strong>Add</strong> in the top right corner.</span>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('pwa-ios-close').addEventListener('click', () => {
      modal.classList.remove('ios-modal-visible');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('ios-modal-visible');
      }
    });
  }

  function showIOSModal() {
    createIOSModal();
    const modal = document.getElementById('pwa-ios-modal');
    if (modal) {
      modal.classList.add('ios-modal-visible');
    }
  }

  // ----------------------------------------------------
  // 6. Global Event Handlers
  // ----------------------------------------------------
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent standard minibar
    e.preventDefault();
    deferredPrompt = e;

    // Check if app is installed
    if (isInstalled()) {
      return;
    }

    // Show custom install UI
    showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] RESOLVIT app was successfully installed!');
    localStorage.setItem(INSTALL_KEY, 'true');
    deferredPrompt = null;
    hideInstallBanner();
  });

  // Initialization when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    registerServiceWorker();
    initNetworkStatusListeners();

    // If installed, ensure state is set
    if (isStandalone()) {
      localStorage.setItem(INSTALL_KEY, 'true');
    }
  });

  // ----------------------------------------------------
  // 7. Public API Export
  // ----------------------------------------------------
  window.RESOLVIT_PWA = {
    promptInstall: triggerInstallPrompt,
    isInstalled: isInstalled,
    isStandalone: isStandalone,
    showIOSInstructions: showIOSModal
  };

})();
