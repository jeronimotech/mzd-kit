import { defineApp, h, fmt } from 'mzd-kit';
import './app.css';

defineApp({
  title: '__TITLE__',

  setup(app) {
    const value = h('div', { class: 'value' }, '0');
    const label = h('div', { class: 'label' }, 'km/h');
    app.root.appendChild(h('div', { class: 'screen' }, value, label));

    // Vehicle data: speed, rpm, fuel, outsideTemp, coolantTemp, gps, …
    app.car.on('speed', (kmh) => {
      value.textContent = fmt(kmh);
    });

    // Commander knob: rotate (dir = 1 | -1), press, up, down, left, right, back
    app.controls.on('press', () => {
      label.textContent = label.textContent === 'km/h' ? '¡Hola!' : 'km/h';
    });
  },
});
