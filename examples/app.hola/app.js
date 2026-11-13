// Hola Mazda — dashboard with speed/RPM, outside temperature and fuel.
// Rotate the knob to change the color theme, press it to swap the main gauge.
import { defineApp, h, fmt } from 'mzd-kit';
import './app.css';

const THEMES = [
  { id: 'soulred', name: 'Soul Red' },
  { id: 'machine', name: 'Machine Gray' },
  { id: 'blue', name: 'Deep Crystal Blue' },
  { id: 'neon', name: 'Neon' },
];

defineApp({
  title: 'Hola Mazda',

  setup(app) {
    let themeIndex = app.store.get('theme', 0);
    let view = 'speed';

    const greeting = h('div', { class: 'greeting' });
    const big = h('div', { class: 'big' });
    const unit = h('div', { class: 'unit' });
    const fill = h('div', { class: 'fill' });
    const tile = (label) => {
      const value = h('div', { class: 'tvalue' }, '--');
      const name = h('div', { class: 'tlabel' }, label);
      return { el: h('div', { class: 'tile' }, value, name), value, name };
    };
    const a = tile('RPM'), b = tile('Afuera'), c = tile('Gasolina');
    const themeLabel = h('div', { class: 'theme-label' });

    const screen = h('div', { class: 'hola' },
      greeting,
      h('div', { class: 'main' }, big, unit),
      h('div', { class: 'bar' }, fill),
      h('div', { class: 'tiles' }, a.el, b.el, c.el),
      themeLabel,
    );
    app.root.appendChild(screen);

    const draw = () => {
      const speed = app.car.get('speed') || 0;
      const rpm = app.car.get('rpm') || 0;
      const hour = new Date().getHours();
      const mins = ('0' + new Date().getMinutes()).slice(-2);
      greeting.textContent = `${hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'}  ·  ${hour}:${mins}`;

      const isSpeed = view === 'speed';
      big.textContent = fmt(isSpeed ? speed : rpm, 0, '0');
      unit.textContent = isSpeed ? 'km/h' : 'rpm';
      fill.style.width = Math.min(100, isSpeed ? (speed / 200) * 100 : (rpm / 6500) * 100) + '%';
      fill.className = 'fill' + (!isSpeed && rpm > 5500 ? ' redline' : '');
      a.value.textContent = fmt(isSpeed ? rpm : speed, 0);
      a.name.textContent = isSpeed ? 'RPM' : 'km/h';
      const out = app.car.get('outsideTemp');
      b.value.textContent = out == null ? '--' : `${Math.round(out)}°`;
      const fuel = app.car.get('fuel');
      c.value.textContent = fuel == null ? '--' : `${Math.round(fuel)}%`;
    };

    const applyTheme = () => {
      const theme = THEMES[themeIndex];
      screen.setAttribute('data-theme', theme.id);
      themeLabel.textContent = `Tema: ${theme.name}  ·  gira la perilla para cambiar`;
      app.store.set('theme', themeIndex);
    };

    ['speed', 'rpm', 'outsideTemp', 'fuel'].forEach((s) => app.car.on(s, draw));

    app.controls.on('rotate', (dir) => {
      themeIndex = (themeIndex + dir + THEMES.length) % THEMES.length;
      applyTheme();
    });
    app.controls.on('press', () => {
      view = view === 'speed' ? 'engine' : 'speed';
      draw();
    });

    applyTheme();
    draw();
    return app.every(30000, draw);
  },
});
