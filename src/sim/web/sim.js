/* mzd-kit simulator UI: app menu, commander, vehicle data, scenarios, network, console. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var host = window.MzdHost;
  var SAVE_KEY = 'mzd-sim-state';

  // ---------------------------------------------------------------- signals
  var SIGNALS = [
    { key: 'speed', id: 'VDTVehicleSpeed', label: 'Velocidad', unit: 'km/h', min: 0, max: 240, step: 1, value: 0, group: 'vehicle' },
    { key: 'rpm', id: 'VDTEngineSpeed', label: 'RPM', unit: 'rpm', min: 0, max: 7500, step: 10, value: 0, group: 'vehicle' },
    { key: 'fuel', id: 'VDTFuelGaugePosition', label: 'Gasolina', unit: '%', min: 0, max: 100, step: 1, value: 72, group: 'vehicle' },
    { key: 'avgConsumption', id: 'VDTDrv1AvlFuelE', label: 'Consumo prom.', unit: 'L/100km', min: 0, max: 25, step: 0.1, value: 7.4, group: 'vehicle' },
    { key: 'outsideTemp', id: 'VDTOut-CarTemperature', label: 'Temp. exterior', unit: '°C', min: -20, max: 50, step: 1, value: 17, group: 'vehicle' },
    { key: 'coolantTemp', id: 'VDTEngClnt_Te_Actl', label: 'Temp. motor', unit: '°C', min: -20, max: 130, step: 1, value: 24, group: 'vehicle' },
    { key: 'intakeTemp', id: 'VDTDR_IntakeAirTemp', label: 'Temp. admisión', unit: '°C', min: -20, max: 80, step: 1, value: 20, group: 'vehicle' },
    { key: 'odometer', id: 'VDTCOdocount', label: 'Odómetro', unit: 'km', min: 0, max: 400000, step: 1, value: 68420, group: 'vehicle', noRange: true },
    { key: 'battery', id: 'VDTCBattery_StateOfCharge', label: 'Batería', unit: '', min: 0, max: 255, step: 1, value: 230, group: 'vehicle' },
    { key: 'latitude', id: 'GPSLatitude', label: 'Latitud', unit: '°', min: -90, max: 90, step: 0.0001, value: 4.6097, group: 'gps', noRange: true },
    { key: 'longitude', id: 'GPSLongitude', label: 'Longitud', unit: '°', min: -180, max: 180, step: 0.0001, value: -74.0817, group: 'gps', noRange: true },
    { key: 'altitude', id: 'GPSAltitude', label: 'Altitud', unit: 'm', min: -100, max: 6000, step: 1, value: 2640, group: 'gps' },
    { key: 'heading', id: 'GPSHeading', label: 'Rumbo', unit: '°', min: 0, max: 359, step: 1, value: 0, group: 'gps' },
    { key: 'gpsSpeed', id: 'GPSVelocity', label: 'Velocidad GPS', unit: 'km/h', min: 0, max: 240, step: 1, value: 0, group: 'gps' },
  ];
  var byKey = {};
  SIGNALS.forEach(function (s) { byKey[s.key] = s; });

  function setSignal(key, value, fromInput) {
    var s = byKey[key];
    var v = Number(value);
    if (isNaN(v)) return;
    // keep full precision internally (scenarios add small increments); round what the car/UI sees
    var dec = s.step < 1 ? String(s.step).split('.')[1].length : 0;
    s.value = v;
    var shown = Number(v.toFixed(dec));
    if (shown !== s.sent) { s.sent = shown; host.setValue(s.id, shown); }
    if (s.num && (!fromInput || fromInput !== s.num)) s.num.value = shown;
    if (s.range && (!fromInput || fromInput !== s.range)) s.range.value = shown;
  }

  function buildSignals() {
    SIGNALS.forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'sig';
      row.innerHTML = '<label>' + s.label + (s.unit ? '<span class="u">' + s.unit + '</span>' : '') + '</label>';
      var num = document.createElement('input');
      num.type = 'number'; num.step = s.step; num.min = s.min; num.max = s.max; num.value = s.value;
      num.addEventListener('input', function () { setSignal(s.key, num.value, num); save(); });
      row.appendChild(num);
      s.num = num;
      if (!s.noRange) {
        var range = document.createElement('input');
        range.type = 'range'; range.step = s.step; range.min = s.min; range.max = s.max; range.value = s.value;
        range.addEventListener('input', function () { stopScenario(); setSignal(s.key, range.value, range); save(); });
        row.appendChild(range);
        s.range = range;
      }
      $('#signals-' + s.group).appendChild(row);
    });
  }

  // ---------------------------------------------------------------- scenarios
  var GEAR_K = [0, 120, 66, 46, 36, 30, 26];
  function rpmFor(speed) {
    if (speed < 1) return 760 + Math.random() * 30;
    var gear = speed < 18 ? 1 : speed < 32 ? 2 : speed < 50 ? 3 : speed < 68 ? 4 : speed < 88 ? 5 : 6;
    return Math.max(900, speed * GEAR_K[gear]);
  }

  var SCENARIOS = {
    off: { label: 'Apagado', tick: function () { return { speed: 0, rpm: 0 }; } },
    idle: { label: 'Encendido', tick: function () { return { speed: 0, rpm: rpmFor(0) }; } },
    city: {
      label: 'Ciudad',
      tick: function (t) {
        var c = t % 40; // 40s cycle: accelerate, cruise, brake, stop
        var speed = c < 8 ? c * 6 : c < 22 ? 46 + Math.sin(c) * 4 : c < 30 ? Math.max(0, 46 - (c - 22) * 6) : 0;
        return { speed: speed, rpm: rpmFor(speed), headingDelta: c === 31 ? 90 : 0 };
      },
    },
    highway: {
      label: 'Autopista',
      tick: function (t) { var s = Math.min(t * 8, 100 + Math.sin(t / 6) * 9); return { speed: s, rpm: rpmFor(s) }; },
    },
    mountain: {
      label: 'Montaña',
      tick: function (t) { var s = 55 + Math.sin(t / 4) * 18; return { speed: s, rpm: rpmFor(s) + 400, climb: 1.2, headingDelta: Math.sin(t / 3) * 6 }; },
    },
  };
  var scenario = null, scenarioT = 0, scenarioTimer = null;
  var TICK = 0.25;

  function startScenario(name) {
    stopScenario();
    scenario = name;
    scenarioT = 0;
    markScenario();
    scenarioTimer = setInterval(stepScenario, TICK * 1000);
    stepScenario();
    save();
  }

  function stopScenario() {
    if (scenarioTimer) clearInterval(scenarioTimer);
    scenarioTimer = null;
    scenario = null;
    markScenario();
  }

  function stepScenario() {
    var r = SCENARIOS[scenario].tick(scenarioT);
    scenarioT += TICK;
    setSignal('speed', r.speed);
    setSignal('rpm', r.rpm);
    setSignal('gpsSpeed', r.speed);
    if (r.rpm > 0) {
      setSignal('coolantTemp', Math.min(90, byKey.coolantTemp.value + 0.15));
      setSignal('fuel', Math.max(0, byKey.fuel.value - r.speed * 0.00002));
      setSignal('odometer', byKey.odometer.value + r.speed / 3600 * TICK);
    }
    if (r.headingDelta) setSignal('heading', (byKey.heading.value + r.headingDelta + 360) % 360);
    if (r.climb) setSignal('altitude', byKey.altitude.value + r.climb);
    if (r.speed > 0) { // move along the heading
      var meters = r.speed / 3.6 * TICK;
      var h = byKey.heading.value * Math.PI / 180;
      var lat = byKey.latitude.value;
      setSignal('latitude', lat + meters * Math.cos(h) / 111320);
      setSignal('longitude', byKey.longitude.value + meters * Math.sin(h) / (111320 * Math.cos(lat * Math.PI / 180)));
    }
  }

  function buildScenarios() {
    Object.keys(SCENARIOS).forEach(function (k) {
      var b = document.createElement('button');
      b.textContent = SCENARIOS[k].label;
      b.dataset.k = k;
      b.addEventListener('click', function () { if (scenario === k) { stopScenario(); save(); } else startScenario(k); });
      $('#scenarios').appendChild(b);
    });
  }
  function markScenario() {
    Array.prototype.forEach.call(document.querySelectorAll('#scenarios button'), function (b) {
      b.classList.toggle('active', b.dataset.k === scenario);
    });
  }

  // ---------------------------------------------------------------- network
  var offline = false;
  function setOffline(v) {
    offline = !!v;
    window.__MZD_OFFLINE = offline;
    var b = $('#net-toggle');
    b.textContent = offline ? '○ Sin conexión' : '● En línea';
    b.className = 'chip ' + (offline ? 'off' : 'on');
    $('#net-icon').className = offline ? 'off' : '';
    window.dispatchEvent(new Event('mzd:network'));
    save();
  }

  // ---------------------------------------------------------------- menu
  var menuIndex = 0;
  var buildErrors = {};

  function menuItems() {
    var items = host.apps();
    Object.keys(buildErrors).forEach(function (id) { if (!items.some(function (a) { return a.id === id; })) items.push({ id: id, title: id, error: true }); });
    return items;
  }

  function renderMenu() {
    var items = menuItems();
    var menu = $('#menu');
    menu.innerHTML = '';
    if (!items.length) {
      menu.innerHTML = '<div class="empty">No hay apps todavía.<br>Crea una con <b>mzd create app.mi-app</b></div>';
      return;
    }
    menuIndex = Math.max(0, Math.min(menuIndex, items.length - 1));
    items.forEach(function (a, i) {
      var el = document.createElement('div');
      el.className = 'item' + (i === menuIndex ? ' focus' : '') + (a.error ? ' err' : '');
      el.textContent = a.title;
      if (a.error) { var tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'error de compilación'; el.appendChild(tag); }
      el.addEventListener('click', function () { menuIndex = i; open(a.id); });
      menu.appendChild(el);
    });
    var focused = menu.children[menuIndex];
    if (focused) {
      var top = focused.offsetTop, bottom = top + focused.offsetHeight;
      if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight + 10;
      if (top < menu.scrollTop) menu.scrollTop = top - 10;
    }
  }

  // Apps with statusbar:false get the whole 800x480 screen, like on the CMU.
  function setStatusbar(visible) {
    $('#statusbar').style.display = visible ? '' : 'none';
    $('#surface').style.top = visible ? '64px' : '0';
  }

  function showMenu() {
    host.exit(true);
    setStatusbar(true);
    $('#surface').style.display = 'none';
    $('#menu').style.display = 'block';
    $('#title').textContent = 'Aplicaciones';
    renderMenu();
    save();
  }

  function open(id) {
    if (buildErrors[id]) { showBuildError(id); return; }
    $('#menu').style.display = 'none';
    $('#surface').style.display = 'block';
    var old = document.querySelector('#surface > .build-error');
    if (old) old.remove();
    if (host.launch(id)) {
      var app = host.apps().filter(function (a) { return a.id === id; })[0];
      $('#title').textContent = app ? app.title : id;
      setStatusbar(!app || app.statusbar);
      save();
    }
  }

  function showBuildError(id) {
    host.exit(true);
    $('#menu').style.display = 'none';
    var s = $('#surface');
    s.style.display = 'block';
    var old = s.querySelector('.build-error');
    if (old) old.remove();
    var box = document.createElement('div');
    box.className = 'build-error';
    box.textContent = id + '\n\n' + buildErrors[id];
    s.appendChild(box);
    $('#title').textContent = id;
  }

  host.on('exit', function () { showMenu(); });

  // ---------------------------------------------------------------- commander
  function controller(eventId) {
    flash(eventId);
    if (host.current()) { host.controller(eventId); return; }
    if (document.querySelector('#surface > .build-error')) { if (eventId === 'goBack') showMenu(); return; }
    var n = menuItems().length;
    if (!n) return;
    if (eventId === 'cw' || eventId === 'downStart') { menuIndex = Math.min(n - 1, menuIndex + 1); renderMenu(); }
    else if (eventId === 'ccw' || eventId === 'upStart') { menuIndex = Math.max(0, menuIndex - 1); renderMenu(); }
    else if (eventId === 'selectStart' || eventId === 'rightStart') { open(menuItems()[menuIndex].id); }
  }

  function flash(eventId) {
    var b = document.querySelector('[data-ev="' + eventId + '"]');
    if (!b) return;
    b.classList.add('active');
    setTimeout(function () { b.classList.remove('active'); }, 140);
  }

  function bindControls() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ev]'), function (b) {
      b.addEventListener('click', function () { controller(b.dataset.ev); });
    });
    $('#home-btn').addEventListener('click', showMenu);

    var keymap = {
      ArrowUp: 'upStart', ArrowDown: 'downStart', ArrowLeft: 'leftStart', ArrowRight: 'rightStart',
      Enter: 'selectStart', ' ': 'selectStart', '[': 'ccw', ']': 'cw', q: 'ccw', e: 'cw',
      Escape: 'goBack', Backspace: 'goBack',
    };
    document.addEventListener('keydown', function (ev) {
      if (/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
      if (ev.key === 'h' || ev.key === 'H') { showMenu(); return; }
      var id = keymap[ev.key];
      if (id) { ev.preventDefault(); controller(id); }
    });

    var lastWheel = 0;
    $('#screen').addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var now = Date.now();
      if (now - lastWheel < 90) return;
      lastWheel = now;
      controller(ev.deltaY > 0 ? 'cw' : 'ccw');
    }, { passive: false });
  }

  // ---------------------------------------------------------------- console
  function log(level, args) {
    var box = $('#log');
    var line = document.createElement('div');
    line.className = 'l ' + level;
    var t = document.createElement('span');
    t.className = 't';
    t.textContent = new Date().toTimeString().slice(0, 8);
    line.appendChild(t);
    line.appendChild(document.createTextNode(Array.prototype.map.call(args, function (a) {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
      return String(a);
    }).join(' ')));
    box.appendChild(line);
    while (box.children.length > 400) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    var orig = console[level].bind(console);
    console[level] = function () { orig.apply(null, arguments); log(level === 'log' ? '' : level, arguments); };
  });
  window.addEventListener('error', function (e) { log('error', [e.message + (e.filename ? '  (' + e.filename.split('/').slice(-2).join('/') + ':' + e.lineno + ')' : '')]); });
  host.on('error', function (e) { log('error', ['[' + e.id + '] ' + e.message]); });
  $('#log-clear').addEventListener('click', function () { $('#log').innerHTML = ''; });

  // ---------------------------------------------------------------- persistence
  function save() {
    try {
      var values = {};
      SIGNALS.forEach(function (s) { values[s.key] = s.value; });
      sessionStorage.setItem(SAVE_KEY, JSON.stringify({ values: values, app: host.current(), scenario: scenario, offline: offline, menuIndex: menuIndex }));
    } catch (e) { /* ignore */ }
  }
  function restore() {
    try { return JSON.parse(sessionStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
  }

  // ---------------------------------------------------------------- loading apps
  window.MzdSim = {
    buildError: function (id, message) {
      buildErrors[id] = message;
      log('error', ['[build] ' + id + ': ' + message]);
    },
    controller: controller,
    setSignal: setSignal,
    open: open,
    home: showMenu,
    startScenario: startScenario,
    stopScenario: stopScenario,
    setOffline: setOffline,
  };

  function loadApps(done) {
    fetch('/api/apps').then(function (r) { return r.json(); }).then(function (apps) {
      var pending = apps.length;
      if (!pending) return done();
      apps.forEach(function (a) {
        var s = document.createElement('script');
        s.src = '/apps/' + a.id + '/app.js?t=' + Date.now();
        s.onload = s.onerror = function () { if (--pending === 0) done(); };
        document.body.appendChild(s);
      });
    }).catch(function (e) { log('error', ['No se pudieron cargar las apps: ' + e.message]); done(); });
  }

  function liveReload() {
    var es = new EventSource('/events');
    var chip = $('#reload-state');
    es.onmessage = function (m) {
      var d = JSON.parse(m.data);
      if (d.type === 'reload') {
        chip.textContent = 'recargando…';
        chip.className = 'chip flash';
        save();
        setTimeout(function () { location.reload(); }, 60);
      }
    };
    es.onerror = function () { chip.textContent = 'sin servidor'; chip.className = 'chip off'; };
    es.onopen = function () { chip.textContent = 'recarga en vivo'; chip.className = 'chip ghost'; };
  }

  function tickClock() {
    var d = new Date();
    $('#clock').textContent = d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  // ---------------------------------------------------------------- boot
  var state = restore();
  buildSignals();
  buildScenarios();
  bindControls();
  if (state.values) Object.keys(state.values).forEach(function (k) { if (byKey[k]) byKey[k].value = state.values[k]; });
  SIGNALS.forEach(function (s) { setSignal(s.key, s.value); });
  setOffline(!!state.offline);
  $('#net-toggle').addEventListener('click', function () { setOffline(!offline); });
  tickClock();
  setInterval(tickClock, 5000);
  liveReload();

  loadApps(function () {
    menuIndex = state.menuIndex || 0;
    if (state.app && (host.apps().some(function (a) { return a.id === state.app; }))) open(state.app);
    else showMenu();
    if (state.scenario && SCENARIOS[state.scenario]) startScenario(state.scenario);
    log('info', ['mzd-kit simulator listo · ' + host.apps().length + ' app(s)']);
  });
})();
