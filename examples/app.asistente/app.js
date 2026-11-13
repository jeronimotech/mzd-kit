// Asistente — Claude in the car. Pick a quick phrase with the knob and press to ask,
// or ask by voice from the phone companion page; answers show up here either way.
import { defineApp, h, render, list } from 'mzd-kit';
import './app.css';

const QUICK = [
  '¿Qué hay cerca para comer?',
  '¿Hay pico y placa hoy?',
  'Resúmeme las noticias',
  '¿Dónde hay una gasolinera cerca?',
  '¿Cómo estará el clima esta tarde?',
  '¿Cómo está el tráfico?',
  'Cuéntame un dato curioso',
];

defineApp({
  title: 'Asistente',

  setup(app) {
    const phrases = list(app, {
      items: app.store.get('quick', QUICK),
      onSelect: (q) => ask(q),
    });

    const question = h('div', { class: 'question' });
    const answer = h('div', { class: 'answer' });
    const scroller = h('div', { class: 'scroller' }, question, answer);
    const status = h('div', { class: 'status' });

    app.root.appendChild(h('div', { class: 'asistente' },
      h('div', { class: 'side' }, phrases.el),
      h('div', { class: 'main' }, scroller, status),
    ));

    const items = {};
    let current = null;

    const show = () => {
      const it = current && items[current];
      if (!it) {
        question.textContent = '';
        render(answer, h('div', { class: 'welcome' },
          h('div', { class: 'hello' }, '¿En qué te ayudo?'),
          h('div', { class: 'mzd-muted' }, 'Gira la perilla para elegir una pregunta y presiónala.'),
          h('div', { class: 'mzd-muted' }, 'También puedes hablarle desde tu celular.'),
        ));
        return;
      }
      question.textContent = (it.source === 'phone' ? 'Desde el celular · ' : '') + it.q;
      answer.className = 'answer ' + it.status;
      answer.textContent = it.status === 'pending' ? 'Pensando…' : it.answer;
      scroller.scrollTop = 0;
    };

    const setStatus = (msg, warn) => {
      status.textContent = msg;
      status.className = 'status' + (warn ? ' warn' : '');
    };

    function ask(q) {
      if (!app.net.online()) { setStatus('Sin conexión a internet', true); return; }
      setStatus('Preguntando…');
      app.ai.ask(q, (err, it) => {
        if (err) { setStatus(`No se pudo preguntar (${err.message})`, true); return; }
        items[it.id] = it;
        current = it.id;
        show();
        setStatus('Gira para elegir · presiona para preguntar');
      });
    }

    // Scroll long answers with up/down on the knob
    app.controls.on('left', () => { scroller.scrollTop -= 80; });
    app.controls.on('right', () => { scroller.scrollTop += 80; });

    let stopWatch = null;
    app.on('focus', () => {
      setStatus(app.net.online() ? 'Gira para elegir · presiona para preguntar' : 'Sin conexión a internet', !app.net.online());
      stopWatch = app.ai.watch((updates) => {
        updates.forEach((it) => {
          items[it.id] = it;
          if (!current || it.id >= current) current = it.id; // newest question wins
        });
        show();
      });
    });
    app.on('blur', () => { if (stopWatch) stopWatch(); stopWatch = null; });
    app.net.on('offline', () => setStatus('Sin conexión a internet', true));
    app.net.on('online', () => setStatus('Gira para elegir · presiona para preguntar'));

    show();
  },
});
