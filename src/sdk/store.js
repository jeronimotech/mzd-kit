// Persistent per-app storage on top of localStorage (survives reboots on the CMU).
export function createStore(appId) {
  const prefix = 'mzd:' + appId + ':';
  return {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(prefix + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(key) {
      try { localStorage.removeItem(prefix + key); } catch (e) { /* ignore */ }
    },
  };
}
