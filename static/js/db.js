/**
 * Armazenamento Local (IndexedDB com fallback para localStorage)
 */
(function (global) {
  'use strict';

  const DB_NAME = 'meteo_diario_pro_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'registos';
  const LS_KEY = 'meteo_diario_pro_registos_v1';

  let dbInstance = null;

  function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB indisponível'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = () => {
        dbInstance = req.result;
        resolve(dbInstance);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllRecords() {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (_) {
      try {
        const raw = localStorage.getItem(LS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      } catch {
        return [];
      }
    }
  }

  async function saveRecord(record) {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      const all = await getAllRecords();
      const idx = all.findIndex((x) => x.id === record.id);
      if (idx >= 0) all[idx] = record;
      else all.unshift(record);
      localStorage.setItem(LS_KEY, JSON.stringify(all));
    }
  }

  async function deleteRecord(id) {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      const all = (await getAllRecords()).filter((x) => x.id !== id);
      localStorage.setItem(LS_KEY, JSON.stringify(all));
    }
  }

  async function importRecords(records) {
    for (const r of records) {
      if (r && r.id) await saveRecord(r);
    }
  }

  global.MeteoDB = {
    getAllRecords,
    saveRecord,
    deleteRecord,
    importRecords
  };
})(window);
