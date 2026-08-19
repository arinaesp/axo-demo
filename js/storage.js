// Storage facade: async interface over what is, today, synchronous
// localStorage. The async shape is deliberate — when a backend lands,
// these methods start fetch()ing and no call site changes.
//
// Every key carries a fixed prefix. The full app namespaces per signed-in
// account; this demo has no accounts, so one namespace per device is all it
// needs — two kids sharing a browser share the same saved progress.
const PREFIX = 'axo-demo:';

// Global, deliberately NOT namespaced: the schema version describes the
// device's stored data as a whole, not one user's.
const SCHEMA_KEY = 'schema_version';

function ns(key) {
  return PREFIX + key;
}

export const storage = {
  // Parsed value, or null when absent (a corrupt value also reads as null).
  async get(key) {
    try {
      const raw = localStorage.getItem(ns(key));
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  },

  async set(key, value) {
    localStorage.setItem(ns(key), JSON.stringify(value));
  },

  async remove(key) {
    localStorage.removeItem(ns(key));
  },

  // Keys of the current user matching the prefix, returned as the caller
  // named them (namespace stripped).
  async list(prefix) {
    const base = ns('');
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(base) && k.slice(base.length).startsWith(prefix)) {
        keys.push(k.slice(base.length));
      }
    }
    return keys;
  },

  // Schema-version hook. No migration logic yet — this just establishes the
  // key on first run so a future migration pass has something to read.
  async getSchemaVersion() {
    const raw = localStorage.getItem(SCHEMA_KEY);
    if (raw === null) {
      console.log('[storage] first run: schema_version set to 1');
      localStorage.setItem(SCHEMA_KEY, '1');
      return 1;
    }
    return Number(raw);
  },

  async setSchemaVersion(n) {
    const prev = localStorage.getItem(SCHEMA_KEY);
    if (String(n) !== prev) {
      console.log(`[storage] schema_version: ${prev} -> ${n}`);
    }
    localStorage.setItem(SCHEMA_KEY, String(n));
  },
};
