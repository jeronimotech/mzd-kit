/**
 * A from-scratch implementation of the CASDK host interface used on the car
 * (window.CustomApplicationsHandler + window.CustomApplication), so the exact same
 * built app.js runs in the simulator and on the CMU.
 *
 * Behaviour mirrors the on-car runtime: `created` runs once, `focused`/`lost` on
 * enter/leave, data is only delivered to the app in front, and current values are
 * replayed to its subscriptions when it gains focus.
 */
(function () {
  var data = {};       // lowercased data id -> value
  var registry = {};   // app id -> { app, canvas, created }
  var order = [];
  var current = null;
  var listeners = {};

  function emit(name, arg) {
    (listeners[name] || []).forEach(function (fn) { fn(arg); });
  }

  function CustomApplication(def) {
    for (var k in def) this[k] = def[k];
    this.__subs = {};
  }
  CustomApplication.prototype.subscribe = function (id, cb) {
    id = String(id && id.id ? id.id : id).toLowerCase();
    if (typeof cb !== 'function') return false;
    this.__subs[id] = cb;
    return true;
  };
  CustomApplication.prototype.unsubscribe = function (id) {
    delete this.__subs[String(id).toLowerCase()];
  };
  CustomApplication.prototype.getSetting = function (k) {
    return this.settings ? this.settings[k] : undefined;
  };
  CustomApplication.prototype.getTitle = function () { return this.getSetting('title') || this.id; };
  CustomApplication.prototype.getId = function () { return this.id; };

  function call(entry, method, arg) {
    try {
      if (typeof entry.app[method] === 'function') return entry.app[method](arg);
    } catch (e) {
      emit('error', { id: entry.app.id, message: method + ': ' + (e && e.message), error: e });
    }
  }

  function canvasFor(entry) {
    if (entry.canvas) return entry.canvas;
    var el = document.createElement('div');
    el.className = 'CustomApplicationCanvas';
    el.setAttribute('app', entry.app.id);
    document.getElementById('surface').appendChild(el);
    // jQuery-ish wrapper (CASDK apps use this.canvas.get(0))
    entry.canvas = el;
    entry.app.canvas = { 0: el, length: 1, get: function () { return el; } };
    return el;
  }

  window.CustomApplication = CustomApplication;

  window.CustomApplicationsHandler = {
    applications: registry,
    register: function (id, app) {
      app.id = id;
      app.location = 'apps/' + id + '/';
      if (!registry[id]) order.push(id);
      registry[id] = { app: app, canvas: null, created: false };
      emit('register', id);
      return true;
    },
  };

  window.MzdHost = {
    on: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    apps: function () {
      return order.map(function (id) { return { id: id, title: registry[id].app.getTitle() }; });
    },
    current: function () { return current; },

    launch: function (id) {
      var entry = registry[id];
      if (!entry) return false;
      if (current && current !== id) this.exit(true);
      var el = canvasFor(entry);
      if (!entry.created) { entry.created = true; call(entry, 'created'); }
      el.style.display = 'block';
      current = id;
      // replay current values to the app's subscriptions (like the CMU does on focus)
      for (var sub in entry.app.__subs) if (data[sub] !== undefined) call({ app: { id: id, f: entry.app.__subs[sub] } }, 'f', data[sub]);
      call(entry, 'focused');
      emit('launch', id);
      return true;
    },

    exit: function (silent) {
      if (!current) return;
      var entry = registry[current];
      call(entry, 'lost');
      if (entry.canvas) entry.canvas.style.display = 'none';
      var id = current;
      current = null;
      if (!silent) emit('exit', id);
    },

    controller: function (eventId) {
      if (!current) return false;
      var consumed = call(registry[current], 'onControllerEvent', eventId);
      if (eventId === 'goBack' && consumed !== true) this.exit();
      return consumed;
    },

    setValue: function (id, value) {
      var key = String(id).toLowerCase();
      data[key] = value;
      if (current) {
        var cb = registry[current].app.__subs[key];
        if (cb) call({ app: { id: current, f: cb } }, 'f', value);
      }
    },
    getValue: function (id) { return data[String(id).toLowerCase()]; },
  };
})();
