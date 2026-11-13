// Commander knob / multicontroller. Normalizes CASDK event ids into friendly events.
import { createEmitter } from './emitter.js';

const MAP = {
  cw: ['rotate', 1],
  ccw: ['rotate', -1],
  selectStart: ['press'],
  upStart: ['up'],
  downStart: ['down'],
  leftStart: ['left'],
  rightStart: ['right'],
  goBack: ['back'],
};

export function createControls() {
  const events = createEmitter();
  return {
    /**
     * Events: `rotate` (dir: 1 | -1), `press`, `up`, `down`, `left`, `right`, `back`, `any` (raw id).
     * Return `true` from a `back` handler to stay in the app instead of going back.
     */
    on: events.on,
    /** @internal dispatch a raw host event id; returns true if consumed */
    _dispatch(eventId) {
      const m = MAP[eventId];
      events.emit('any', eventId);
      if (!m) return false;
      if (m[0] === 'rotate') return events.emit('rotate', m[1]) || true;
      return events.emit(m[0]);
    },
  };
}
