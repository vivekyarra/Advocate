import { createSeedState } from './seed.js';

const DB_NAME = 'advocate-demo-account';
const STORE_NAME = 'state';
const KEY = 'singleton';
const DB_VERSION = 1;

function clone(value) {
  return structuredClone(value);
}

export class IndexedDbRepository {
  constructor(indexedDBImpl = globalThis.indexedDB) {
    if (!indexedDBImpl) throw new Error('IndexedDB is unavailable in this browser.');
    this.indexedDB = indexedDBImpl;
    this.dbPromise = null;
  }

  async #open() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  async ensureSeeded() {
    const db = await this.#open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const get = store.get(KEY);
      get.onsuccess = () => {
        if (!get.result) store.put(createSeedState(), KEY);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Seed transaction aborted'));
    });
  }

  async read() {
    await this.ensureSeeded();
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(KEY);
      request.onsuccess = () => resolve(clone(request.result));
      request.onerror = () => reject(request.error);
    });
  }

  async update(mutator) {
    await this.ensureSeeded();
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const get = store.get(KEY);
      let output;
      get.onsuccess = () => {
        const draft = clone(get.result);
        output = mutator(draft);
        store.put(draft, KEY);
      };
      tx.oncomplete = () => resolve(clone(output));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Update transaction aborted'));
    });
  }

  async reset() {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(createSeedState(), KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export class MemoryRepository {
  constructor(initialState = createSeedState()) {
    this.state = clone(initialState);
    this.queue = Promise.resolve();
  }

  async ensureSeeded() {}

  async read() {
    await this.queue;
    return clone(this.state);
  }

  async update(mutator) {
    let result;
    const task = this.queue.catch(() => {}).then(async () => {
      const draft = clone(this.state);
      result = mutator(draft);
      this.state = draft;
    });
    this.queue = task.catch(() => {});
    await task;
    return clone(result);
  }

  async reset() {
    await this.update((draft) => {
      Object.keys(draft).forEach((key) => delete draft[key]);
      Object.assign(draft, createSeedState());
    });
  }
}
