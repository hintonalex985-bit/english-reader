/**
 * Simple IndexedDB wrapper for caching uploaded PDF files.
 * Uses a single object store to persist the last uploaded file.
 */

const DB_NAME = 'english-reader-cache';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const FILE_KEY = 'lastPdf';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save a File (PDF) to IndexedDB cache.
 */
export async function cachePdfFile(file: File): Promise<void> {
  try {
    const db = await openDB();
    const arrayBuffer = await file.arrayBuffer();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ name: file.name, type: file.type, data: arrayBuffer }, FILE_KEY);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Failed to cache PDF:', err);
  }
}

/**
 * Load the cached PDF file from IndexedDB. Returns null if nothing is cached.
 */
export async function loadCachedPdf(): Promise<File | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(FILE_KEY);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.data) {
          const file = new File([result.data], result.name || 'cached.pdf', {
            type: result.type || 'application/pdf'
          });
          resolve(file);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('Failed to load cached PDF:', err);
    return null;
  }
}

/**
 * Clear the cached PDF from IndexedDB.
 */
export async function clearCachedPdf(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(FILE_KEY);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Failed to clear cached PDF:', err);
  }
}
