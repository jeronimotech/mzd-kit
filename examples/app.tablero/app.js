// Tablero — full-screen dashboard (800x480, no status bar) in the Mi Mazda style.
// Center: speed. Sides: RPM and engine temperature. Bottom strip: consumption, fuel, outside temp, clock.
// Knob: rotate to switch the accent color, press to toggle the center gauge (speed ↔ RPM).
import { defineApp, h, fmt } from 'mzd-kit';
import './app.css';

const SVG = 'http://www.w3.org/2000/svg';
const ACCENTS = [
  { id: 'soulred', color: '#d0102a', glow: '#ff3b55' },
  { id: 'blue', color: '#1f6bff', glow: '#5c9bff' },
  { id: 'neon', color: '#18c37a', glow: '#4cf2a6' },
  { id: 'silver', color: '#a9afb9', glow: '#e3e7ee' },
];

function svg(tag, attrs) {
  const el = document.createElementNS(SVG, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

/**
 * Arc gauge: 270° track + value arc using stroke-dasharray (old-WebKit friendly).
 * Returns { el, set(value, fraction, warn) }.
 */
function gauge({ size, stroke, label, big }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const visible = c * 0.75;
  const root = h('div', { class: 'gauge' + (big ? ' big' : ''), style: { width: size + 'px', height: size + 'px' } });
  const s = svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  const g = svg('g', { transform: `rotate(135 ${size / 2} ${size / 2})` });
  const track = svg('circle', {
    cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'rgba(255,255,255,0.12)', 'stroke-width': stroke,
    'stroke-linecap': 'round', 'stroke-dasharray': `${visible} ${c}`,
  });
  const arc = svg('circle', {
    cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, class: 'arc',
    'stroke-linecap': 'round', 'stroke-dasharray': `0 ${c}`,
  });
  g.appendChild(track);
  g.appendChild(arc);
  s.appendChild(g);
  root.appendChild(s);
  const value = h('div', { class: 'gvalue' }, '--');
  const unit = h('div', { class: 'gunit' }, label);
  root.appendChild(h('div', { class: 'gcenter' }, value, unit));
  return {
    el: root,
    set(text, fraction, warn, unitText) {
      const f = Math.max(0, Math.min(1, fraction || 0));
      arc.setAttribute('stroke-dasharray', `${(visible * f).toFixed(1)} ${c}`);
      value.textContent = text;
      if (unitText) unit.textContent = unitText;
      root.className = 'gauge' + (big ? ' big' : '') + (warn ? ' warn' : '');
    },
  };
}

// Small line icons as SVG paths (the CMU's fonts have no emoji).
const ICONS = {
  drop: 'M12 3 C12 3 5 11 5 15 a7 7 0 0 0 14 0 C19 11 12 3 12 3 Z',
  fuel: 'M5 21 V5 a2 2 0 0 1 2 -2 h6 a2 2 0 0 1 2 2 v16 M3 21 h14 M8 8 h4 M15 9 l3 2 v7 a1.5 1.5 0 0 0 3 0 v-9 l-3 -3',
  sun: 'M12 8 a4 4 0 1 0 0.01 0 Z M12 2 v2 M12 20 v2 M4.9 4.9 l1.4 1.4 M17.7 17.7 l1.4 1.4 M2 12 h2 M20 12 h2 M4.9 19.1 l1.4 -1.4 M17.7 6.3 l1.4 -1.4',
};

function icon(name) {
  const s = svg('svg', { width: 26, height: 26, viewBox: '0 0 24 24' });
  s.appendChild(svg('path', { d: ICONS[name], fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return s;
}

function stat(iconName, label) {
  const value = h('div', { class: 'svalue' }, '--');
  const el = h('div', { class: 'stat' }, h('div', { class: 'sicon' }, icon(iconName)), h('div', null, value, h('div', { class: 'slabel' }, label)));
  return { el, value };
}

defineApp({
  title: 'Tablero',
  statusbar: false, // the whole 800x480 screen is ours

  setup(app) {
    let accent = app.store.get('accent', 0);
    let centerRpm = false;

    const speed = gauge({ size: 330, stroke: 26, label: 'km/h', big: true });
    const rpm = gauge({ size: 200, stroke: 16, label: 'rpm' });
    const temp = gauge({ size: 200, stroke: 16, label: 'motor °C' });

    const consumption = stat('drop', 'L/100 km');
    const fuel = stat('fuel', 'gasolina');
    const outside = stat('sun', 'afuera');
    const clock = h('div', { class: 'clock' });

    const screen = h('div', { class: 'tablero' },
      h('div', { class: 'glow' }),
      h('div', { class: 'row' },
        h('div', { class: 'side left' }, rpm.el),
        h('div', { class: 'center' }, speed.el),
        h('div', { class: 'side right' }, temp.el),
      ),
      h('div', { class: 'strip' }, consumption.el, fuel.el, outside.el, clock),
    );
    app.root.appendChild(screen);

    const draw = () => {
      const v = (k) => app.car.get(k);
      const s = v('speed'), r = v('rpm'), t = v('coolantTemp');
      if (centerRpm) {
        speed.set(fmt(r), (r || 0) / 7000, (r || 0) > 6000, 'rpm');
        rpm.set(fmt(s), (s || 0) / 180, false, 'km/h');
      } else {
        speed.set(fmt(s), (s || 0) / 180, false, 'km/h');
        rpm.set(fmt(r), (r || 0) / 7000, (r || 0) > 6000, 'rpm');
      }
      temp.set(t == null ? '--' : fmt(t) + '°', ((t || 0) - 20) / 100, (t || 0) > 105);

      const avg = v('avgConsumption');
      consumption.value.textContent = avg == null ? '--' : fmt(avg, 1).replace('.', ',');
      const f = v('fuel');
      fuel.value.textContent = f == null ? '--' : fmt(f) + '%';
      fuel.el.className = 'stat' + (f != null && f < 12 ? ' warn' : '');
      const o = v('outsideTemp');
      outside.value.textContent = o == null ? '--' : fmt(o) + '°';
      const d = new Date();
      clock.textContent = d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
    };

    const applyAccent = () => {
      screen.setAttribute('data-accent', ACCENTS[accent].id);
      app.store.set('accent', accent);
    };

    ['speed', 'rpm', 'coolantTemp', 'avgConsumption', 'fuel', 'outsideTemp'].forEach((k) => app.car.on(k, draw));
    app.controls.on('rotate', (dir) => {
      accent = (accent + dir + ACCENTS.length) % ACCENTS.length;
      applyAccent();
    });
    app.controls.on('press', () => {
      centerRpm = !centerRpm;
      draw();
    });

    applyAccent();
    draw();
    return app.every(15000, draw);
  },
});
