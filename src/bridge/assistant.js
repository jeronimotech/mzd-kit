// mzd-kit assistant: Claude for the car, through the bridge.
//
// Questions come from the car (quick phrases picked with the knob) or from the phone
// companion page (voice or text). Both land in one shared feed; the car polls the feed
// and shows answers, the phone can read them aloud. Answers are short, glanceable Spanish.
//
// Requires Anthropic credentials on the bridge (ANTHROPIC_API_KEY). The key never
// reaches the car.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.MZD_ASSISTANT_MODEL || 'claude-opus-5-5';
// Low effort keeps in-car latency down; raise it with MZD_ASSISTANT_EFFORT if answers feel thin.
const EFFORT = process.env.MZD_ASSISTANT_EFFORT || 'low';
const MAX_FEED = 50;
const HISTORY_TURNS = 4; // previous Q/A pairs sent for follow-ups ("¿y cuál queda más cerca?")
const MAX_PAUSE_RESUMES = 3;

const SYSTEM = `Eres el asistente de voz y pantalla de un carro (Mazda). Tus respuestas se muestran en la pantalla del tablero (800x480) y el celular del conductor puede leerlas en voz alta.

Cómo responder:
- Español de Colombia, tono cercano y directo.
- Máximo 3 frases cortas (unas 50 palabras). Sin markdown, sin viñetas, sin enlaces, sin emojis.
- Empieza por lo accionable: el dato, el lugar, la hora o la recomendación.
- Para cualquier cosa que dependa de información actual (noticias, tráfico, lugares abiertos, horarios, precios, pico y placa, eventos), usa la búsqueda web antes de responder.
- Usa el contexto del carro (ubicación aproximada, velocidad, hora) cuando sea relevante, sin repetirlo.
- Si no encuentras un dato confiable, dilo en una frase y sugiere qué preguntar.
- Si el carro va en movimiento, nunca le pidas al conductor que mire o toque el celular o la pantalla.`;

function contextLine(ctx) {
  const parts = [];
  if (ctx.city) parts.push(`ciudad: ${ctx.city}${ctx.country ? ` (${ctx.country})` : ''}`);
  if (isFinite(ctx.lat) && isFinite(ctx.lon)) parts.push(`ubicación aproximada: ${Number(ctx.lat).toFixed(3)}, ${Number(ctx.lon).toFixed(3)}`);
  if (isFinite(ctx.speed)) parts.push(ctx.speed > 3 ? `en movimiento a ${Math.round(ctx.speed)} km/h` : 'detenido');
  parts.push(`hora local: ${new Date().toLocaleString('es-CO', { timeZone: ctx.timezone || undefined, weekday: 'long', hour: '2-digit', minute: '2-digit' })}`);
  return `[Contexto del carro — ${parts.join('; ')}]`;
}

function textOf(content) {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'El asistente no está configurado: falta una API key válida de Anthropic en el puente.';
  if (e instanceof Anthropic.RateLimitError) return 'Demasiadas preguntas seguidas. Intenta de nuevo en un momento.';
  if (e instanceof Anthropic.APIConnectionError) return 'El puente no pudo conectarse con el asistente. Revisa la conexión a internet.';
  if (e instanceof Anthropic.APIError) return `El asistente respondió con un error (${e.status}).`;
  if (/api.?key|authentication|credentials/i.test(String(e && e.message))) {
    return 'El asistente no está configurado: falta ANTHROPIC_API_KEY en el puente.';
  }
  return 'No se pudo obtener respuesta del asistente.';
}

/**
 * @param {{ client?: { beta: { messages: { create: Function } } }, city?: string, country?: string, timezone?: string, log?: Function }} [opts]
 *   `client` lets tests inject a fake; by default the official SDK resolves credentials from the environment.
 */
export function createAssistant(opts = {}) {
  let client = opts.client || null;
  const log = opts.log || (() => {});
  const feed = [];
  let seq = 0;
  const context = {
    city: opts.city || process.env.MZD_ASSISTANT_CITY || null,
    country: opts.country || process.env.MZD_ASSISTANT_COUNTRY || null,
    timezone: opts.timezone || process.env.MZD_ASSISTANT_TIMEZONE || null,
  };

  function api() {
    if (!client) client = new Anthropic();
    return client;
  }

  function webSearchTool() {
    const tool = { type: 'web_search_20260209', name: 'web_search', max_uses: 3 };
    // Only city + timezone: web search accepts a limited set of country codes (e.g. "CO" is
    // rejected with a 400), so the country goes in the text context instead.
    if (context.city || context.timezone) {
      tool.user_location = { type: 'approximate' };
      if (context.city) tool.user_location.city = context.city;
      if (context.timezone) tool.user_location.timezone = context.timezone;
    }
    return tool;
  }

  function history(beforeId) {
    const done = feed.filter((i) => i.id < beforeId && i.status === 'done').slice(-HISTORY_TURNS);
    const msgs = [];
    for (const i of done) {
      msgs.push({ role: 'user', content: i.q });
      msgs.push({ role: 'assistant', content: i.answer });
    }
    return msgs;
  }

  async function run(item) {
    const messages = history(item.id).concat([{ role: 'user', content: `${contextLine(Object.assign({}, context, item.ctx))}\n\n${item.q}` }]);
    let response;
    for (let attempt = 0; attempt <= MAX_PAUSE_RESUMES; attempt++) {
      response = await api().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: EFFORT },
        system: SYSTEM,
        tools: [webSearchTool()],
        messages,
      });
      // A long server-tool turn can pause; send it back so the server continues it.
      if (response.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: response.content });
    }
    if (response.stop_reason === 'refusal') return 'No puedo ayudar con esa pregunta.';
    const text = textOf(response.content);
    return text || 'No tengo una respuesta para eso.';
  }

  function ask(q, source, ctx) {
    const question = String(q || '').trim().slice(0, 500);
    if (!question) return null;
    const item = { id: ++seq, q: question, source: source === 'phone' ? 'phone' : 'car', status: 'pending', answer: null, ts: Date.now(), ctx: ctx || {} };
    feed.push(item);
    while (feed.length > MAX_FEED) feed.shift();
    const t = Date.now();
    run(item)
      .then((answer) => { item.answer = answer; item.status = 'done'; log(`assistant ✓ #${item.id} ${Date.now() - t} ms`); })
      .catch((e) => { item.answer = friendlyError(e); item.status = 'error'; log(`assistant ✗ #${item.id} ${e && e.message}`); })
      .finally(() => { item.updated = Date.now(); });
    return item;
  }

  function publicItem(i) {
    return { id: i.id, q: i.q, source: i.source, status: i.status, answer: i.answer, ts: i.ts, updated: i.updated || i.ts };
  }

  return {
    ask: (q, source, ctx) => { const i = ask(q, source, ctx); return i && publicItem(i); },
    /** Items created or updated after `since` (ms timestamp). */
    feed: (since) => feed.filter((i) => (i.updated || i.ts) > (since || 0)).map(publicItem),
    setContext(ctx) {
      for (const k of ['lat', 'lon', 'speed']) if (ctx[k] != null && isFinite(ctx[k])) context[k] = Number(ctx[k]);
    },
    get context() { return Object.assign({}, context); },
  };
}
