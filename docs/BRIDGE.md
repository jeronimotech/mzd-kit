# The mzd-kit bridge

The CMU's browser dates from ~2013: it likely can't negotiate the TLS versions modern APIs
require, it has little memory, and car connectivity is intermittent. Instead of fighting that,
mzd-kit apps talk plain HTTP to a **bridge** that does the real internet work and returns small
JSON documents designed for the car.

```
 CMU app ──HTTP/JSON──▶ mzd bridge ──HTTPS──▶ the internet (APIs, AI, …)
 (ES5, offline cache)   (phone, laptop, VPS)
```

## Running it

```bash
mzd bridge --port 7070                          # local network, proxy disabled
MZD_BRIDGE_TOKEN=change-me mzd bridge          # token required on every request
```

Then point your app at it: `defineApp({ bridge: 'http://<bridge-ip>:7070', … })`.
In `mzd dev` the bridge is mounted at `/bridge` on the simulator, which is the default.

## Where should the bridge run?

- **Development:** inside `mzd dev` (automatic).
- **In the car, via the phone's hotspot:** the CMU joins the phone's Wi-Fi; the bridge runs on a
  small cloud server (reachable over the hotspot's internet) or on the phone itself.
- **Cloud:** any Node ≥22 host. Always set `MZD_BRIDGE_TOKEN` when it's reachable from the internet.

> How the CMU obtains connectivity (Wi-Fi client to a hotspot, Bluetooth PAN) depends on the
> firmware and jailbreak tweaks and is still being validated — see the roadmap.

## Endpoints

### `GET /v1/ping`
`{ ok: true, time, version }`

### `GET /v1/weather?lat=<lat>&lon=<lon>`
```json
{
  "lat": 4.61, "lon": -74.08, "timezone": "America/Bogota",
  "current": { "time": "…", "temp": 16.6, "feelsLike": 14.6, "wind": 15.4, "code": 1, "isDay": true,
               "description": "Mayormente despejado" },
  "hourly": [{ "time": "…", "temp": 16.1, "rain": 41, "code": 1 }]
}
```

### `GET /v1/proxy?url=<http(s) URL>`
`{ status, contentType, body }` (body as text, max 1 MB). Disabled on public interfaces unless a
token is configured — an open proxy is a liability.

## Security

- Set `MZD_BRIDGE_TOKEN` and pass it as `?token=` or the `X-MZD-Token` header.
- The bridge never stores data. Keep it behind HTTPS (e.g. a reverse proxy) when exposed, and keep
  the car → bridge hop on a network you control where possible.
