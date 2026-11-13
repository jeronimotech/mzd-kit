import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { createAssistant } from '../src/bridge/assistant.js';
import { startBridge } from '../src/bridge/index.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeClient(responder) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (params) => { calls.push(params); return responder(params, calls.length); } } },
  };
}

const reply = (text, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'text', text }] });

test('asks Claude with the car context and short-answer system prompt', async () => {
  const client = fakeClient(() => reply('Hay un restaurante a 200 m.'));
  const a = createAssistant({ client, city: 'Bogotá', country: 'CO', timezone: 'America/Bogota' });
  a.setContext({ lat: 4.61, lon: -74.08, speed: 40 });
  const item = a.ask('¿Qué hay cerca para comer?', 'car');
  assert.equal(item.status, 'pending');
  await wait(10);
  const [done] = a.feed(0);
  assert.equal(done.status, 'done');
  assert.equal(done.answer, 'Hay un restaurante a 200 m.');

  const p = client.calls[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.tools[0].type, 'web_search_20260209');
  assert.equal(p.tools[0].user_location.city, 'Bogotá');
  assert.equal(p.tools[0].user_location.country, undefined);
  assert.match(p.messages[0].content, /Bogotá \(CO\)/);
  assert.match(p.messages[0].content, /4\.610, -74\.080/);
  assert.match(p.messages[0].content, /40 km\/h/);
  assert.match(p.system, /Máximo 3 frases/);
});

test('resumes paused server-tool turns', async () => {
  const client = fakeClient((_p, n) => (n === 1 ? { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use' }] } : reply('Listo.')));
  const a = createAssistant({ client });
  a.ask('noticias', 'phone');
  await wait(10);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].messages.at(-1).role, 'assistant');
  assert.equal(a.feed(0)[0].answer, 'Listo.');
});

test('joins text blocks split by citations', async () => {
  const client = fakeClient(() => ({ stop_reason: 'end_turn', content: [
    { type: 'server_tool_use' }, { type: 'web_search_tool_result' },
    { type: 'text', text: 'Hoy hay pico y placa ' }, { type: 'text', text: 'para placas pares.' },
  ] }));
  const a = createAssistant({ client });
  a.ask('pico y placa');
  await wait(10);
  assert.equal(a.feed(0)[0].answer, 'Hoy hay pico y placa para placas pares.');
});

test('sends recent turns for follow-up questions', async () => {
  const client = fakeClient((_p, n) => reply(n === 1 ? 'El Corral queda a 300 m.' : 'Abre hasta las 10 pm.'));
  const a = createAssistant({ client });
  a.ask('¿Dónde comer?');
  await wait(10);
  a.ask('¿Hasta qué hora abre?');
  await wait(10);
  const msgs = client.calls[1].messages;
  assert.equal(msgs.length, 3);
  assert.equal(msgs[1].content, 'El Corral queda a 300 m.');
});

test('turns API errors into readable Spanish messages', async () => {
  const client = fakeClient(() => { throw new Anthropic.AuthenticationError(401, { error: {} }, 'invalid x-api-key', new Headers()); });
  const a = createAssistant({ client });
  a.ask('hola');
  await wait(10);
  const [it] = a.feed(0);
  assert.equal(it.status, 'error');
  assert.match(it.answer, /API key/);
});

test('refusals become a short message', async () => {
  const client = fakeClient(() => ({ stop_reason: 'refusal', content: [] }));
  const a = createAssistant({ client });
  a.ask('algo');
  await wait(10);
  assert.equal(a.feed(0)[0].answer, 'No puedo ayudar con esa pregunta.');
});

test('bridge endpoints: car asks by GET, phone by POST, both see the feed', async () => {
  const client = fakeClient((p) => reply('R: ' + p.messages.at(-1).content.split('\n\n').pop()));
  const server = await startBridge({ port: 0, host: '127.0.0.1', assistantClient: client });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const car = await (await fetch(base + '/v1/assistant/ask?q=hola&lat=4.6&lon=-74&speed=10')).json();
    assert.equal(car.source, 'car');
    const phone = await (await fetch(base + '/v1/assistant/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: '¿qué tal?' }),
    })).json();
    assert.equal(phone.source, 'phone');
    await wait(20);
    const feed = await (await fetch(base + '/v1/assistant/feed?since=0')).json();
    assert.equal(feed.items.length, 2);
    assert.deepEqual(feed.items.map((i) => i.answer), ['R: hola', 'R: ¿qué tal?']);
    // phone question used the car's last known location
    assert.match(client.calls[1].messages.at(-1).content, /4\.600, -74\.000/);
    assert.equal((await fetch(base + '/v1/assistant/ask')).status, 400);
    const page = await fetch(base + '/companion');
    assert.match(await page.text(), /asistente/);
  } finally {
    server.close();
  }
});
