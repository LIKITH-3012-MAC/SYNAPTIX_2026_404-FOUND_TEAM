/**
 * RESOLVIT Offline-First IndexedDB Engine
 * Manages local database storage for offline queues, API caches, drafts, and chat history.
 */

(function () {
  'use strict';

  const DB_NAME = 'resolvit-db';
  const DB_VERSION = 1;
  let dbPromise = null;

  function initDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        console.warn('[OfflineDB] IndexedDB is not supported in this browser.');
        return resolve(null);
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Pending Sync Queue
        if (!db.objectStoreNames.contains('pending_sync')) {
          const syncStore = db.createObjectStore('pending_sync', { keyPath: 'id', autoIncrement: true });
          syncStore.createIndex('status', 'status', { unique: false });
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
          syncStore.createIndex('url', 'url', { unique: false });
        }

        // 2. Cached API Responses
        if (!db.objectStoreNames.contains('cached_api')) {
          const apiStore = db.createObjectStore('cached_api', { keyPath: 'url' });
          apiStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 3. User Drafts (Forms / Notes)
        if (!db.objectStoreNames.contains('user_drafts')) {
          const draftStore = db.createObjectStore('user_drafts', { keyPath: 'key' });
          draftStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // 4. Chat History
        if (!db.objectStoreNames.contains('chat_history')) {
          const chatStore = db.createObjectStore('chat_history', { keyPath: 'id', autoIncrement: true });
          chatStore.createIndex('sessionId', 'sessionId', { unique: false });
          chatStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        console.log('[OfflineDB] IndexedDB connected successfully');
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        console.error('[OfflineDB] Error connecting to IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });

    return dbPromise;
  }

  // ----------------------------------------------------
  // Pending Sync Queue Operations
  // ----------------------------------------------------
  async function savePendingSync(item) {
    const db = await initDB();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending_sync', 'readwrite');
      const store = tx.objectStore('pending_sync');
      const record = {
        url: item.url,
        method: item.method || 'POST',
        headers: item.headers || {},
        body: item.body || null,
        timestamp: Date.now(),
        status: 'pending',
        attempts: 0,
        description: item.description || 'Offline action'
      };
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getPendingSyncItems() {
    const db = await initDB();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending_sync', 'readonly');
      const store = tx.objectStore('pending_sync');
      const index = store.index('status');
      const req = index.getAll('pending');
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function removePendingSyncItem(id) {
    const db = await initDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending_sync', 'readwrite');
      const store = tx.objectStore('pending_sync');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ----------------------------------------------------
  // Cached API Responses
  // ----------------------------------------------------
  async function cacheApiResponse(url, data) {
    const db = await initDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cached_api', 'readwrite');
      const store = tx.objectStore('cached_api');
      const record = {
        url: url,
        data: data,
        timestamp: Date.now()
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function getCachedApiResponse(url) {
    const db = await initDB();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cached_api', 'readonly');
      const store = tx.objectStore('cached_api');
      const req = store.get(url);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error);
    });
  }

  // ----------------------------------------------------
  // Drafts Management
  // ----------------------------------------------------
  async function saveDraft(key, data) {
    const db = await initDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('user_drafts', 'readwrite');
      const store = tx.objectStore('user_drafts');
      const record = { key, data, updatedAt: Date.now() };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function getDraft(key) {
    const db = await initDB();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('user_drafts', 'readonly');
      const store = tx.objectStore('user_drafts');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function removeDraft(key) {
    const db = await initDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('user_drafts', 'readwrite');
      const store = tx.objectStore('user_drafts');
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ----------------------------------------------------
  // Global Export
  // ----------------------------------------------------
  window.RESOLVIT_DB = {
    init: initDB,
    savePendingSync,
    getPendingSyncItems,
    removePendingSyncItem,
    cacheApiResponse,
    getCachedApiResponse,
    saveDraft,
    getDraft,
    removeDraft
  };

  // Initialize DB on load
  document.addEventListener('DOMContentLoaded', () => {
    initDB().catch((err) => console.warn('[OfflineDB] Initialization deferred:', err));
  });

})();
