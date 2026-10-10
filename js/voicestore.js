// Amma's recordings live in IndexedDB on the user's own phone (too big for
// localStorage). Each entry is { data: ArrayBuffer, type, savedAt }, keyed by cue.

const DB_NAME = 'amma-dishti';
const STORE = 'voice';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export function getClip(key) {
  return run('readonly', (s) => s.get(key)).catch(() => null);
}

export function putClip(key, data, type) {
  return run('readwrite', (s) => s.put({ data, type, savedAt: Date.now() }, key));
}

export function deleteClip(key) {
  return run('readwrite', (s) => s.delete(key)).catch(() => {});
}

export function listClipKeys() {
  return run('readonly', (s) => s.getAllKeys()).catch(() => []);
}

export function clearClips() {
  return run('readwrite', (s) => s.clear()).catch(() => {});
}
