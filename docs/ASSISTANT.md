# The in-car AI assistant

```
 knob quick phrases ─┐                         ┌─▶ car screen (app.ai.watch)
                     ├─▶ bridge ─▶ Claude ─────┤
 phone voice / text ─┘   (feed)   + web search └─▶ phone (read aloud)
```

## Setup

```bash
export ANTHROPIC_API_KEY=sk-ant-…          # only on the bridge
export MZD_ASSISTANT_CITY="Bogotá"          # optional: better local search results
export MZD_ASSISTANT_TIMEZONE=America/Bogota
mzd dev examples                            # or: mzd bridge
```

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. Never ship it to the car |
| `MZD_ASSISTANT_MODEL` | `claude-opus-5-5` | Model id |
| `MZD_ASSISTANT_EFFORT` | `low` | `low` keeps answers fast in the car; `medium`/`high` think longer |
| `MZD_ASSISTANT_CITY` / `_TIMEZONE` | — | Passed to web search as approximate location |
| `MZD_ASSISTANT_COUNTRY` | — | Added to the text context only (web search rejects some country codes) |

Requests use the server-side refusal fallback (`fallbacks: "default"`), resume paused web-search
turns, and keep the last 4 Q/A pairs so follow-ups like "¿y hasta qué hora abre?" work.
Typical latency with web search: ~10 s.

## Voice

- **Phone (works today):** `/companion` uses the browser's speech recognition. Browsers only allow
  it on **https** or `localhost`; over plain LAN http the page asks you to use the keyboard's
  dictation mic instead (works everywhere). Answers are spoken with `speechSynthesis` (es-CO).
- **The car's microphone:** the CMU browser can't capture audio. On a jailbroken CMU a native
  recorder could stream to the bridge — on the roadmap.

## Privacy

Questions, the car's approximate location and speed go to Anthropic's API. The bridge keeps the
last 50 items in memory only (nothing is written to disk).

## Safety

Answers are capped at ~3 short sentences and the model is told never to ask the driver to look
at or touch a screen while moving. Prefer asking by voice from the phone, and keep your eyes on
the road.
