// Clima — weather where the car is, through the mzd-kit bridge.
// Shows how to use app.net with offline cache and the car's GPS.
import { defineApp, h, render, fmt } from 'mzd-kit';
import './app.css';

defineApp({
  title: 'Clima',

  setup(app) {
    const status = h('div', { class: 'status' });
    const body = h('div', { class: 'body' });
    app.root.appendChild(h('div', { class: 'clima' }, body, status));

    const show = (data, meta) => {
      const now = data.current;
      render(body, [
        h('div', { class: 'place' }, data.place || `${fmt(data.lat, 2)}, ${fmt(data.lon, 2)}`),
        h('div', { class: 'now' },
          h('div', { class: 'temp' }, `${fmt(now.temp)}°`),
          h('div', { class: 'desc' },
            h('div', { class: 'cond' }, now.description),
            h('div', { class: 'mzd-muted' }, `Sensación ${fmt(now.feelsLike)}° · Viento ${fmt(now.wind)} km/h`),
          ),
        ),
        h('div', { class: 'hours' }, data.hourly.slice(0, 6).map((hr) =>
          h('div', { class: 'hour' },
            h('div', { class: 'hh' }, hr.time.slice(11, 16)),
            h('div', { class: 'ht' }, `${fmt(hr.temp)}°`),
            h('div', { class: 'hp' }, `${fmt(hr.rain)}%`),
          ))),
      ]);
      const mins = meta && meta.fromCache ? Math.round(meta.age / 60) : 0;
      status.textContent = meta && meta.stale
        ? `Sin conexión · mostrando datos de hace ${mins} min`
        : `Actualizado ${mins ? `hace ${mins} min` : 'ahora'} · presiona la perilla para refrescar`;
      status.className = 'status' + (meta && meta.stale ? ' stale' : '');
    };

    const load = () => {
      const gps = app.car.get('gps');
      // Fall back to Bogotá when there's no GPS fix yet
      const lat = gps.lat != null ? gps.lat : 4.6097;
      const lon = gps.lon != null ? gps.lon : -74.0817;
      status.textContent = 'Cargando…';
      app.net.get(`/v1/weather?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`, { cache: 600 }, (err, data, meta) => {
        if (err) {
          status.textContent = err.message === 'offline' ? 'Sin conexión a internet' : `No se pudo cargar (${err.message})`;
          status.className = 'status stale';
          return;
        }
        show(data, meta);
      });
    };

    app.controls.on('press', load);
    app.on('focus', load);
    app.net.on('online', load);
    return app.every(10 * 60 * 1000, load);
  },
});
