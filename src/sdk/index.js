/**
 * mzd-kit SDK — build apps for the Mazda Connect CMU with modern JavaScript.
 *
 *   import { defineApp, h } from 'mzd-kit';
 *   defineApp({
 *     title: 'Hola',
 *     setup(app) {
 *       const speed = h('div', { class: 'big' });
 *       app.root.appendChild(speed);
 *       app.car.on('speed', (v) => { speed.textContent = Math.round(v); });
 *       app.controls.on('press', () => { ... });
 *     },
 *   });
 *
 * `mzd build` compiles this to ES5 and wraps it for the on-car CASDK host
 * (CustomApplicationsHandler), which the mzd-kit simulator also implements.
 */
import './polyfills.js';
import { createCar, SIGNALS } from './car.js';
import { createControls } from './controls.js';
import { createStore } from './store.js';
import { createNet } from './net.js';
import { createEmitter } from './emitter.js';
import { h, render, list, fmt } from './ui.js';
import BASE_CSS from './base.css.js';

export { h, render, list, fmt, SIGNALS };

export const version = '0.1.0';

const injected = {};

/** Inject a stylesheet once (used by the build for `import './app.css'`). */
export function injectCss(css, key) {
  if (key && injected[key]) return;
  if (key) injected[key] = true;
  const style = document.createElement('style');
  style.type = 'text/css';
  if (key) style.setAttribute('data-mzd', key);
  style.appendChild(document.createTextNode(css));
  (document.head || document.getElementsByTagName('head')[0]).appendChild(style);
}

/* global __MZD_APP_ID__ */
function buildTimeId() {
  return typeof __MZD_APP_ID__ !== 'undefined' ? __MZD_APP_ID__ : null;
}

/**
 * Define and register an app.
 * @param {{
 *   id?: string, title: string, statusbar?: boolean, bridge?: string,
 *   setup: (app: AppContext) => (void | (() => void))
 * }} def
 */
export function defineApp(def) {
  if (!def || typeof def.setup !== 'function') throw new Error('[mzd-kit] defineApp needs a setup(app) function');
  let id = def.id || buildTimeId();
  if (!id) throw new Error('[mzd-kit] app id missing (name the folder app.<name> or pass id)');
  if (id.indexOf('app.') !== 0) id = 'app.' + id;

  const host = typeof window !== 'undefined' ? window.CustomApplicationsHandler : null;
  const AppClass = typeof window !== 'undefined' ? window.CustomApplication : null;
  if (!host || !AppClass) {
    if (typeof console !== 'undefined') console.warn('[mzd-kit] no CASDK host found; "' + id + '" was not registered');
    return null;
  }

  injectCss(BASE_CSS, 'mzd-base');

  let ctx = null;
  let cleanup = null;

  const casdkApp = new AppClass({
    require: { js: [], css: [], images: {} },
    settings: {
      title: def.title || id,
      statusbar: def.statusbar !== false,
      statusbarIcon: true,
      statusbarTitle: false,
      hasLeftButton: false,
      hasMenuCaret: false,
      hasRightArc: false,
    },

    created: function () {
      const self = this;
      const canvas = this.canvas && this.canvas.get ? this.canvas.get(0) : this.canvas;
      const lifecycle = createEmitter();
      const root = document.createElement('div');
      root.className = 'mzd-app';
      canvas.appendChild(root);

      ctx = {
        id: id,
        title: def.title || id,
        root: root,
        car: createCar((dataId, cb) => self.subscribe(dataId, cb)),
        controls: createControls(),
        store: createStore(id),
        net: createNet(id, { bridge: def.bridge }),
        /** URL of a file shipped in the app's `public/` folder */
        asset: (file) => (self.location || ('apps/' + id + '/')) + file,
        /** lifecycle: `focus`, `blur` */
        on: lifecycle.on,
        _lifecycle: lifecycle,
        every(ms, fn) {
          const t = setInterval(fn, ms);
          return () => clearInterval(t);
        },
      };

      try {
        const result = def.setup(ctx);
        if (typeof result === 'function') cleanup = result;
      } catch (e) {
        root.innerHTML = '';
        root.appendChild(h('div', { class: 'mzd-error' }, h('b', null, 'Error en ' + id), h('div', null, String(e && e.message))));
        if (typeof console !== 'undefined') console.error('[mzd-kit] setup failed for ' + id, e);
      }
    },

    focused: function () {
      if (ctx) { ctx.net._check(); ctx._lifecycle.emit('focus'); }
    },

    lost: function () {
      if (ctx) ctx._lifecycle.emit('blur');
    },

    terminated: function () {
      if (cleanup) try { cleanup(); } catch (e) { /* ignore */ }
    },

    onControllerEvent: function (eventId) {
      return ctx ? ctx.controls._dispatch(eventId) : false;
    },
  });

  host.register(id, casdkApp);
  return casdkApp;
}
