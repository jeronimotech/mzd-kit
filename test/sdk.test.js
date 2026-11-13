import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCar } from '../src/sdk/car.js';
import { createControls } from '../src/sdk/controls.js';
import { createEmitter } from '../src/sdk/emitter.js';

function fakeHost() {
  const subs = {};
  return {
    subscribe: (id, cb) => { subs[id] = cb; },
    push: (id, v) => subs[id] && subs[id](v),
    subs,
  };
}

test('car maps friendly names to CMU data ids', () => {
  const host = fakeHost();
  const car = createCar(host.subscribe);
  const seen = [];
  car.on('speed', (v) => seen.push(v));
  assert.ok(host.subs.VDTVehicleSpeed);
  host.push('VDTVehicleSpeed', '87');
  host.push('VDTVehicleSpeed', '87'); // duplicate ignored
  host.push('VDTVehicleSpeed', 90);
  assert.deepEqual(seen, [87, 90]);
  assert.equal(car.get('speed'), 90);
});

test('car aggregates gps', () => {
  const host = fakeHost();
  const car = createCar(host.subscribe);
  let last = null;
  car.on('gps', (g) => { last = g; });
  host.push('GPSLatitude', 4.61);
  host.push('GPSLongitude', -74.08);
  assert.equal(last.lat, 4.61);
  assert.equal(last.lon, -74.08);
});

test('car replays the current value to late subscribers', () => {
  const host = fakeHost();
  const car = createCar(host.subscribe);
  car.on('rpm', () => {});
  host.push('VDTEngineSpeed', 2500);
  let got = null;
  car.on('rpm', (v) => { got = v; });
  assert.equal(got, 2500);
});

test('unknown signals throw a helpful error', () => {
  const car = createCar(() => {});
  assert.throws(() => car.on('warpDrive', () => {}), /unknown car signal "warpDrive"/);
});

test('controls normalize commander events', () => {
  const c = createControls();
  const log = [];
  c.on('rotate', (d) => log.push('rotate' + d));
  c.on('press', () => log.push('press'));
  c._dispatch('cw');
  c._dispatch('ccw');
  c._dispatch('selectStart');
  assert.deepEqual(log, ['rotate1', 'rotate-1', 'press']);
});

test('back is only consumed when a handler returns true', () => {
  const c = createControls();
  assert.equal(c._dispatch('goBack'), false);
  c.on('back', () => true);
  assert.equal(c._dispatch('goBack'), true);
});

test('emitter unsubscribe and error isolation', () => {
  const e = createEmitter();
  let n = 0;
  const off = e.on('x', () => { n++; });
  e.on('x', () => { throw new Error('boom'); });
  const origError = console.error;
  console.error = () => {};
  e.emit('x');
  off();
  e.emit('x');
  console.error = origError;
  assert.equal(n, 1);
});
