# mzd-kit API

```js
import { defineApp, h, render, list, fmt, injectCss, SIGNALS, version } from 'mzd-kit';
```

## `defineApp(definition)`

| Field | Type | |
|---|---|---|
| `title` | `string` | Shown in the app list and status bar |
| `setup(app)` | `function` | Called once when the app is first opened. May return a cleanup function |
| `id` | `string` | Optional. Defaults to the folder name (`app.<name>`) |
| `statusbar` | `boolean` | Show the status bar (default `true`) |
| `bridge` | `string` | Bridge base URL for `app.net` (e.g. `http://192.168.1.20:7070`) |

The app's drawing area is **800×416 px** below the status bar (800×480 without it).

## The `app` context

### `app.root`
The `HTMLElement` your app draws into (absolutely positioned, fills the area).

### `app.car`
| Method | |
|---|---|
| `on(signal, fn)` | Subscribe; `fn(value)` is called on change and immediately with the last value. Returns an unsubscribe function |
| `get(signal)` | Last known value or `null` |
| `unit(signal)` | Unit string |

Signals (values already in human units):

| Signal | Unit | Signal | Unit |
|---|---|---|---|
| `speed` | km/h | `outsideTemp` | °C |
| `rpm` | rpm | `intakeTemp` | °C |
| `fuel` | % | `coolantTemp` | °C |
| `avgConsumption` | L/100km | `odometer` | km |
| `battery` | raw | `heading` | ° |
| `latitude`, `longitude` | ° | `altitude` | m |
| `gpsSpeed` | km/h | `gps` | `{ lat, lon, altitude, heading, speed }` |

### `app.controls`
`on(event, fn)` → unsubscribe. Events:

| Event | Payload | Physical input |
|---|---|---|
| `rotate` | `1` (clockwise) or `-1` | Turn the commander knob |
| `press` | | Press the knob |
| `up` `down` `left` `right` | | Push/tilt the knob |
| `back` | | Back button. Return `true` to stay in the app |
| `any` | raw CASDK event id | Everything |

### `app.on(event, fn)`
Lifecycle: `focus` (the app comes to front), `blur` (it goes to background).

### `app.store`
Per-app persistent storage (localStorage on the CMU survives reboots).
`get(key, fallback)`, `set(key, value)`, `remove(key)`. Values are JSON.

### `app.net`
| Method | |
|---|---|
| `get(url, [options], cb)` | `cb(err, data, meta)`. Paths starting with `/` go to the bridge |
| `online()` | `true` if the network is believed up |
| `on('online' \| 'offline', fn)` | Connectivity changes |
| `url(path)` | Resolve a bridge path to a full URL |

Options: `cache` (seconds a cached copy counts as fresh; also enables offline fallback),
`timeout` (ms, default 8000), `json` (default `true`).
`meta` is `{ fromCache, stale, age }`; when the network fails and a cached copy exists you get
the cached data with `stale: true` instead of an error.

### `app.every(ms, fn)`
`setInterval` that returns a stop function (handy as `setup`'s return value).

### `app.asset(file)`
URL of a file in your app's `public/` folder.

## UI helpers

- `h(tag, props, ...children)` — create elements. `props` supports `class`, `style` (object),
  `text`, `html`, `onClick`-style listeners and any attribute.
- `render(el, children)` — replace an element's children.
- `list(app, { items, render, onSelect, onFocus })` — knob-driven list (rotate to move, press to
  select, touch works too). Returns `{ el, setItems, focus, index, destroy }`.
- `fmt(value, decimals = 0, placeholder = '--')` — number formatting tolerant of missing data.

## Constraints of the CMU (what the build handles for you, and what it doesn't)

- **Handled:** ES2015+ syntax → ES5, CSS scoping and `-webkit-` prefixes, small polyfills
  (`Object.assign`, `Array.prototype.find/includes`, `Array.from`, `String#includes/startsWith`).
- **Not available:** `async`/`await` and generators (the build rejects them), `fetch` and
  `Promise` (use `app.net`), CSS custom properties, flexbox `gap`, modern TLS from the car.
- Keep apps light: the CMU has little RAM and a slow CPU. Prefer CSS transforms for animation.
