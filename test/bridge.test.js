import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBridge } from '../src/bridge/index.js';

async function withBridge(opts, fn) {
  const server = await startBridge({ port: 0, host: '127.0.0.1', ...opts });
  const { port } = server.address();
  try { await fn(`http://127.0.0.1:${port}`); } finally { server.close(); }
}

test('ping responds with CORS headers', () =>
  withBridge({}, async (base) => {
    const r = await fetch(base + '/v1/ping');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal((await r.json()).ok, true);
  }));

test('token is enforced when configured', () =>
  withBridge({ token: 's3cret' }, async (base) => {
    assert.equal((await fetch(base + '/v1/ping')).status, 401);
    assert.equal((await fetch(base + '/v1/ping?token=s3cret')).status, 200);
    assert.equal((await fetch(base + '/v1/ping', { headers: { 'X-MZD-Token': 's3cret' } })).status, 200);
  }));

test('weather validates coordinates', () =>
  withBridge({}, async (base) => {
    assert.equal((await fetch(base + '/v1/weather?lat=999&lon=0')).status, 400);
  }));

test('unknown endpoints list what exists', () =>
  withBridge({}, async (base) => {
    const r = await fetch(base + '/v1/nope');
    assert.equal(r.status, 404);
    assert.ok((await r.json()).endpoints.includes('/v1/weather'));
  }));
