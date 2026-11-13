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
//
// Security: when MZD_BRIDGE_TOKEN is set, every request needs ?token=… or X-MZD-Token.
// /v1/proxy is refused entirely without a token unless the bridge only listens on localhost.
import http from 'node:http';

export const BRIDGE_VERSION = '0.1.0';
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

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-MZD-Token',
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
 * @param {{ token?: string, local?: boolean }} [opts]  local = only reachable from this machine
 * @returns {(req, res, pathname: string, query: URLSearchParams) => Promise<void>}
 */
export function createBridgeHandler(opts = {}) {
  const token = opts.token || process.env.MZD_BRIDGE_TOKEN || '';
  return async function handle(req, res, pathname, query) {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (token && query.get('token') !== token && req.headers['x-mzd-token'] !== token) {
      return send(res, 401, { error: 'token required' });
    }
    try {
      if (pathname === '/v1/ping') return send(res, 200, { ok: true, time: new Date().toISOString(), version: BRIDGE_VERSION });
      if (pathname === '/v1/weather') { const [s, b] = await weather(query); return send(res, s, b); }
      if (pathname === '/v1/proxy') {
        if (!token && !opts.local) return send(res, 403, { error: 'proxy needs MZD_BRIDGE_TOKEN when the bridge is public' });
        const [s, b] = await proxy(query); return send(res, s, b);
      }
      return send(res, 404, { error: 'unknown endpoint', endpoints: ['/v1/ping', '/v1/weather', '/v1/proxy'] });
    } catch (e) {
      return send(res, 502, { error: e.name === 'TimeoutError' ? 'upstream timeout' : String(e.message || e) });
    }
  };
}

/** Run the bridge as a standalone server. */
export function startBridge({ port = 7070, host = '0.0.0.0', token } = {}) {
  const local = host === '127.0.0.1' || host === 'localhost';
  const handle = createBridgeHandler({ token, local });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    handle(req, res, url.pathname, url.searchParams);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
