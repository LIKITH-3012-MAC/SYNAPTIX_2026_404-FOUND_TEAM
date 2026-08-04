/**
 * RESOLVIT Background Sync Engine
 * Manages automatic replay of queued offline actions when network connectivity returns.
 */

(function () {
  'use strict';

  let isSyncing = false;

  async function syncPendingRequests() {
    if (isSyncing || !navigator.onLine) return;
    if (!window.RESOLVIT_DB) return;

    isSyncing = true;
    let syncedCount = 0;

    try {
      const pendingItems = await window.RESOLVIT_DB.getPendingSyncItems();
      if (!pendingItems || pendingItems.length === 0) {
        isSyncing = false;
        return;
      }

      console.log(`[SyncManager] Found ${pendingItems.length} pending offline actions to sync...`);

      for (const item of pendingItems) {
        try {
          const fetchOptions = {
            method: item.method || 'POST',
            headers: item.headers || { 'Content-Type': 'application/json' },
          };

          if (item.body) {
            fetchOptions.body = typeof item.body === 'object' ? JSON.stringify(item.body) : item.body;
          }

          const response = await fetch(item.url, fetchOptions);

          if (response.ok || response.status < 500) {
            // Successfully processed or client-side valid status -> remove from queue
            await window.RESOLVIT_DB.removePendingSyncItem(item.id);
            syncedCount++;
            console.log(`[SyncManager] Successfully synced item #${item.id} -> ${item.url}`);
          } else {
            console.warn(`[SyncManager] Server returned status ${response.status} for item #${item.id}`);
          }
        } catch (err) {
          console.warn(`[SyncManager] Network error syncing item #${item.id}:`, err);
          // Stop sync loop on true network disconnect
          break;
        }
      }

      if (syncedCount > 0) {
        showSyncToast(`${syncedCount} offline action${syncedCount > 1 ? 's' : ''} synchronized!`);
        window.dispatchEvent(new CustomEvent('resolvit:synced', { detail: { count: syncedCount } }));
      }

    } catch (err) {
      console.error('[SyncManager] Error during sync loop:', err);
    } finally {
      isSyncing = false;
    }
  }

  async function enqueueOfflineRequest(url, options = {}, description = 'Offline action') {
    if (!window.RESOLVIT_DB) {
      console.warn('[SyncManager] RESOLVIT_DB not ready to enqueue request.');
      return false;
    }

    try {
      await window.RESOLVIT_DB.savePendingSync({
        url: url,
        method: options.method || 'POST',
        headers: options.headers || {},
        body: options.body || null,
        description: description
      });

      showSyncToast('Saved offline. Will sync automatically when online.');
      return true;
    } catch (err) {
      console.error('[SyncManager] Failed to enqueue request:', err);
      return false;
    }
  }

  function showSyncToast(message) {
    let toast = document.getElementById('pwa-network-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pwa-network-toast';
      document.body.appendChild(toast);
    }

    toast.className = 'toast-online toast-show';
    toast.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> <span>${message}</span>`;

    setTimeout(() => {
      toast.classList.remove('toast-show');
    }, 4000);
  }

  // Event Listeners
  window.addEventListener('online', () => {
    console.log('[SyncManager] Network restored. Triggering auto-sync...');
    setTimeout(syncPendingRequests, 1000);
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (navigator.onLine) {
      setTimeout(syncPendingRequests, 2000);
    }
  });

  // Global Export
  window.RESOLVIT_SYNC = {
    sync: syncPendingRequests,
    enqueue: enqueueOfflineRequest
  };

})();
