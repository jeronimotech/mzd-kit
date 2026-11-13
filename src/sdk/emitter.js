// Tiny event emitter. `on` returns an unsubscribe function.
export function createEmitter() {
  const handlers = {};
  return {
    on(name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
      return () => {
        const list = handlers[name] || [];
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      };
    },
    emit(name, a, b) {
      const list = (handlers[name] || []).slice();
      let handled = false;
      for (let i = 0; i < list.length; i++) {
        try {
          if (list[i](a, b) === true) handled = true;
        } catch (e) {
          if (typeof console !== 'undefined') console.error('[mzd-kit] handler for "' + name + '" failed:', e && e.message);
        }
      }
      return handled;
    },
    has(name) {
      return !!(handlers[name] && handlers[name].length);
    },
    clear() {
      for (const k in handlers) delete handlers[k];
    },
  };
}
