// mzd-kit bridge — the car's gateway to the modern internet.
//
// The CMU browser is old (weak TLS, slow CPU, little RAM). The bridge runs somewhere with
// real internet (your laptop, a phone, a cloud VM) and turns big modern APIs into small,
// plain-HTTP JSON the car can digest.
//
// Endpoints (all GET, all JSON):
//   /v1/ping                       → { ok, time, version }
//   /v1/weather?lat=&lon=          → current + next hours (Open-Meteo, no API key)
//   /v1/proxy?url=https://…        → fetches a URL for the car (requires a token unless local)
//   /v1/assistant/ask?q=…          → asks the AI assistant (GET from the car, POST JSON from the phone)
//   /v1/assistant/feed?since=…     → questions + answers newer than `since` (the car polls this)
//   /companion                     → phone page: voice/text questions, answers read aloud
//
// Security: when MZD_BRIDGE_TOKEN is set, every request needs ?token=… or X-MZD-Token.
// /v1/proxy is refused entirely without a token unless the bridge only listens on localhost.
//
// Public mode (MZD_BRIDGE_PUBLIC=1, for a cloud bridge used by the mobile app):
//   - every assistant call needs a `device` id; each device has its own private feed
//   - rate limits per device and per IP, and a global daily budget of assistant questions
//     (MZD_ASSISTANT_DAILY_LIMIT, default 1000) to cap API spend
//   - /v1/proxy is disabled
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAssistant } from './assistant.js';
import { createRateLimiter, createDailyBudget, createDeviceMap, validDevice, clientIp } from './limits.js';

const COMPANION_HTML = fileURLToPath(new URL('./companion.html', import.meta.url));

export const BRIDGE_VERSION = '0.2.0';
const MAX_PROXY_BYTES = 1024 * 1024;

const WMO_ES = {
  0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Niebla', 48: 'Niebla con escarcha',
  51: 'Llovizna ligera', 53: 'Llovizna', 55: 'Llovizna intensa',
  61: 'Lluvia ligera', 63: 'Lluvia', 65: 'Lluvia fuerte',
  66: 'Lluvia helada', 67: 'Lluvia helada fuerte',
  71: 'Nieve ligera', 73: 'Nieve', 75: 'Nieve fuerte', 77: 'Granizo fino',
  80: 'Chubascos ligeros', 81: 'Chubascos', 82: 'Chubascos fuertes',
  85: 'Chubascos de nieve', 86: 'Chubascos de nieve fuertes',
  95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta fuerte con granizo',
};

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size <= limit) chunks.push(c); });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function ctxFrom(src) {
  const ctx = {};
  for (const k of ['lat', 'lon', 'speed']) {
    const v = src[k] == null || src[k] === '' ? NaN : Number(src[k]);
    if (isFinite(v)) ctx[k] = v;
  }
  return ctx;
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-MZD-Token, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

async function weather(q) {
  const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return [400, { error: 'lat/lon required' }];
  }
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day' +
    '&hourly=temperature_2m,precipitation_probability,weather_code&forecast_hours=12&timezone=auto';
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [502, { error: 'weather upstream ' + r.status }];
  const d = await r.json();
  const nowHour = d.current.time.slice(0, 13);
  const hourly = d.hourly.time
    .map((t, i) => ({
      time: t,
      temp: d.hourly.temperature_2m[i],
      rain: d.hourly.precipitation_probability[i],
      code: d.hourly.weather_code[i],
    }))
    .filter((h) => h.time.slice(0, 13) > nowHour);
  return [200, {
    lat, lon,
    timezone: d.timezone,
    current: {
      time: d.current.time,
      temp: d.current.temperature_2m,
      feelsLike: d.current.apparent_temperature,
      wind: d.current.wind_speed_10m,
      code: d.current.weather_code,
      isDay: !!d.current.is_day,
      description: WMO_ES[d.current.weather_code] || 'Código ' + d.current.weather_code,
    },
    hourly,
  }];
}

async function proxy(q) {
  const target = q.get('url') || '';
  let u;
  try { u = new URL(target); } catch { return [400, { error: 'invalid url' }]; }
  if (!/^https?:$/.test(u.protocol)) return [400, { error: 'only http(s)' }];
  const r = await fetch(u, { signal: AbortSignal.timeout(10000), redirect: 'follow' });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_PROXY_BYTES) return [413, { error: 'response too large for the car' }];
  return [200, {
    status: r.status,
    contentType: r.headers.get('content-type'),
    body: buf.toString('utf8'),
  }];
}

/**
 * Create the bridge request handler.
 * @param {{ token?: string, local?: boolean, public?: boolean, assistantClient?: object, log?: Function,
 *           dailyLimit?: number, perDeviceHour?: number, perIpHour?: number }} [opts]
 *   local = only reachable from this machine; assistantClient lets tests inject a fake Anthropic client
 * @returns {(req, res, pathname: string, query: URLSearchParams) => Promise<void>}
 */
export function createBridgeHandler(opts = {}) {
  const token = opts.token || process.env.MZD_BRIDGE_TOKEN || '';
  const isPublic = opts.public ?? process.env.MZD_BRIDGE_PUBLIC === '1';
  const assistants = createDeviceMap(() => createAssistant({ client: opts.assistantClient, log: opts.log }));
  const budget = createDailyBudget(opts.dailyLimit ?? Number(process.env.MZD_ASSISTANT_DAILY_LIMIT || (isPublic ? 1000 : 0)));
  const perDevice = createRateLimiter({ max: opts.perDeviceHour ?? 30, windowMs: 3600_000 });
  const perIp = createRateLimiter({ max: opts.perIpHour ?? 90, windowMs: 3600_000 });

  // Self-hosted bridges keep the original single shared feed (car + phone of one owner).
  function deviceOf(value) {
    if (!isPublic) return validDevice(value) ? value : 'default';
    return validDevice(value) ? value : null;
  }

  return async function handle(req, res, pathname, query) {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (token && query.get('token') !== token && req.headers['x-mzd-token'] !== token) {
      return send(res, 401, { error: 'token required' });
    }
    try {
      if (pathname === '/companion') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return fs.createReadStream(COMPANION_HTML).pipe(res);
      }
      if (pathname === '/v1/ping') return send(res, 200, { ok: true, time: new Date().toISOString(), version: BRIDGE_VERSION });
      if (pathname === '/v1/assistant/ask') {
        const body = req.method === 'POST' ? await readJson(req) : {};
        const device = deviceOf(body.device || query.get('device'));
        if (!device) return send(res, 400, { error: 'device required' });
        const q = body.q || query.get('q');
        if (!q || !String(q).trim()) return send(res, 400, { error: 'q required' });
        if (isPublic && (!perDevice.allow(device) || !perIp.allow(clientIp(req)))) {
          return send(res, 429, { error: 'Demasiadas preguntas. Intenta de nuevo en un rato.' });
        }
        if (!budget.take()) return send(res, 429, { error: 'El asistente alcanzó su límite de hoy. Vuelve mañana.' });
        const assistant = assistants.get(device);
        const source = body.source || query.get('source') || (req.method === 'POST' ? 'phone' : 'car');
        const ctx = ctxFrom(req.method === 'POST' ? body : Object.fromEntries(query));
        assistant.setContext(ctx);
        return send(res, 200, assistant.ask(q, source, ctx));
      }
      if (pathname === '/v1/assistant/feed') {
        const device = deviceOf(query.get('device'));
        if (!device) return send(res, 400, { error: 'device required' });
        const assistant = assistants.get(device);
        assistant.setContext(ctxFrom(Object.fromEntries(query)));
        return send(res, 200, { now: Date.now(), items: assistant.feed(Number(query.get('since')) || 0) });
      }
      if (pathname === '/v1/weather') { const [s, b] = await weather(query); return send(res, s, b); }
      if (pathname === '/v1/proxy') {
        if (isPublic) return send(res, 403, { error: 'proxy disabled on public bridges' });
        if (!token && !opts.local) return send(res, 403, { error: 'proxy needs MZD_BRIDGE_TOKEN when the bridge is public' });
        const [s, b] = await proxy(query); return send(res, s, b);
      }
      return send(res, 404, { error: 'unknown endpoint', endpoints: ['/v1/ping', '/v1/weather', '/v1/proxy', '/v1/assistant/ask', '/v1/assistant/feed', '/companion'] });
    } catch (e) {
      return send(res, 502, { error: e.name === 'TimeoutError' ? 'upstream timeout' : String(e.message || e) });
    }
  };
}

/** Run the bridge as a standalone server. */
export function startBridge({ port = 7070, host = '0.0.0.0', token, assistantClient, log, ...limits } = {}) {
  const local = host === '127.0.0.1' || host === 'localhost';
  const handle = createBridgeHandler({ token, local, assistantClient, log, ...limits });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    handle(req, res, url.pathname, url.searchParams);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
