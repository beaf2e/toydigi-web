/* 아주 작은 IndexedDB 래퍼 — 촬영한 사진(필름롤) 저장 */
const DB = (() => {
  const NAME = 'toydigi';
  const STORE = 'photos';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const req = indexedDB.open(NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbp;
  }

  function tx(mode) {
    return open().then(db => db.transaction(STORE, mode).objectStore(STORE));
  }

  return {
    async add(blob, presetName, kind = 'photo', meta = null) {
      const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const rec = { id, blob, preset: presetName, kind, meta, ts: Date.now() };
      const store = await tx('readwrite');
      return new Promise((res, rej) => {
        const r = store.add(rec);
        r.onsuccess = () => res(rec);
        r.onerror = () => rej(r.error);
      });
    },
    async all() {
      const store = await tx('readonly');
      return new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res((r.result || []).sort((a, b) => b.ts - a.ts));
        r.onerror = () => rej(r.error);
      });
    },
    async remove(id) {
      const store = await tx('readwrite');
      return new Promise((res, rej) => {
        const r = store.delete(id);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
    async clear() {
      const store = await tx('readwrite');
      return new Promise((res, rej) => {
        const r = store.clear();
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    },
  };
})();
