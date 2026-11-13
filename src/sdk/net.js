// Car-grade networking: XHR (no fetch/Promise needed), timeouts, offline cache.
//
// The CMU browser is old and likely can't speak modern TLS, so apps should talk to an
// mzd-kit bridge (see `mzd bridge`) which does the real internet work and returns small JSON.
// Paths starting with "/" are resolved against the bridge URL.
import { createEmitter } from './emitter.js';

const DEFAULT_TIMEOUT = 8000;

function bridgeBase(explicit) {
  if (explicit) return explicit.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.MZD_BRIDGE) return String(window.MZD_BRIDGE).replace(/\/$/, '');
  return '/bridge'; // simulator default (same origin)
}

export function createNet(appId, options) {
  const opts = options || {};
  const events = createEmitter();
  const cachePrefix = 'mzd-cache:' + appId + ':';
  let lastOnline = isOnline();

  function isOnline() {
    if (typeof window !== 'undefined' && window.__MZD_OFFLINE) return false;
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  function check() {
    const now = isOnline();
    if (now !== lastOnline) {
      lastOnline = now;
      events.emit(now ? 'online' : 'offline');
    }
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    window.addEventListener('mzd:network', check);
  }

  function resolve(url) {
    if (/^https?:\/\//.test(url)) return url;
    return bridgeBase(opts.bridge) + (url.charAt(0) === '/' ? url : '/' + url);
  }

  function readCache(key) {
    try {
      const raw = localStorage.getItem(cachePrefix + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeCache(key, data) {
    try { localStorage.setItem(cachePrefix + key, JSON.stringify({ t: Date.now(), data: data })); } catch (e) { /* full */ }
  }

  /**
   * GET a resource.
   * @param {string} url  absolute URL, or a bridge path like "/v1/weather?lat=4.6&lon=-74"
   * @param {{cache?: number, timeout?: number, json?: boolean}} [o]  cache = seconds a cached copy is fresh
   * @param {(err: Error|null, data?: any, meta?: {fromCache: boolean, stale: boolean, age: number}) => void} cb
   */
  function get(url, o, cb) {
    if (typeof o === 'function') { cb = o; o = {}; }
    o = o || {};
    const json = o.json !== false;
    const key = url;
    const cached = o.cache ? readCache(key) : null;
    const age = cached ? (Date.now() - cached.t) / 1000 : Infinity;

    if (cached && age < o.cache) {
      cb(null, cached.data, { fromCache: true, stale: false, age: age });
      return { abort() {} };
    }

    function fallback(err) {
      if (cached) cb(null, cached.data, { fromCache: true, stale: true, age: age, error: err });
      else cb(err);
    }

    if (!isOnline()) {
      fallback(new Error('offline'));
      return { abort() {} };
    }

    const xhr = new XMLHttpRequest();
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { xhr.abort(); } catch (e) { /* ignore */ }
      fallback(new Error('timeout'));
    }, o.timeout || DEFAULT_TIMEOUT);

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4 || done) return;
      done = true;
      clearTimeout(timer);
      // status 0 happens for file:// loads on the CMU; treat a non-empty body as success
      const ok = (xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText);
      if (!ok) return fallback(new Error('http ' + xhr.status));
      let data = xhr.responseText;
      if (json) {
        try { data = JSON.parse(data); } catch (e) { return fallback(new Error('invalid json')); }
      }
      if (o.cache) writeCache(key, data);
      cb(null, data, { fromCache: false, stale: false, age: 0 });
    };
    xhr.open('GET', resolve(url), true);
    xhr.send();
    return { abort() { if (!done) { done = true; clearTimeout(timer); try { xhr.abort(); } catch (e) { /* ignore */ } } } };
  }

  return {
    get: get,
    online: isOnline,
    /** events: `online`, `offline` */
    on: events.on,
    url: resolve,
    _check: check,
  };
}
