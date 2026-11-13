import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { findApps, buildApp, buildAll, compileCss, assertEs5, toEs5 } from '../src/build/index.js';

const EXAMPLES = new URL('../examples', import.meta.url).pathname;

test('finds example apps by folder', () => {
  const ids = findApps(EXAMPLES).map((a) => a.id);
  assert.deepEqual(ids, ['app.clima', 'app.hola']);
});

test('built apps are valid ES5 and register with the CASDK host', async () => {
  for (const app of findApps(EXAMPLES)) {
    const { code } = await buildApp(app, { minify: true });
    assert.doesNotThrow(() => assertEs5(code));

    // run it against a fake CASDK host + minimal DOM
    const registered = [];
    const styles = [];
    const el = () => ({ setAttribute() {}, appendChild(c) { styles.push(c); }, style: {} });
    const sandbox = {
      document: { createElement: el, createTextNode: (t) => t, head: el() },
      localStorage: { getItem: () => null, setItem() {} },
      navigator: { onLine: true },
      console,
      setInterval, clearInterval, setTimeout, clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.CustomApplication = function (def) { Object.assign(this, def); };
    sandbox.CustomApplicationsHandler = { register: (id, a) => registered.push({ id, a }) };
    vm.runInNewContext(code, sandbox);

    assert.equal(registered.length, 1);
    assert.equal(registered[0].id, app.id);
    assert.equal(typeof registered[0].a.created, 'function');
    assert.equal(typeof registered[0].a.onControllerEvent, 'function');
    assert.ok(registered[0].a.settings.title);
    assert.ok(styles.length >= 2, 'base + app css injected');
  }
});

test('css is scoped to the app and prefixed for old WebKit', async () => {
  const css = await compileCss(
    'body{color:red} .a,.b>p{display:flex;transition:opacity 1s} @keyframes k{from{opacity:0}to{opacity:1}}',
    'app.x'
  );
  assert.match(css, /\[app="app\.x"\]\{color:red\}|\[app="app\.x"\] ?\{\s*color: ?red/);
  assert.match(css, /\[app="app\.x"\] \.a,\s*\[app="app\.x"\] \.b>p/);
  assert.match(css, /-webkit-transition/);
  assert.match(css, /display:-webkit-box|display: -webkit-box/);
  assert.match(css, /@keyframes k\{from\{opacity:0\}|from ?\{/); // keyframe selectors untouched
  assert.doesNotMatch(css, /\[app="app\.x"\] from/);
});

test('rejects code that is not ES5', () => {
  assert.throws(() => assertEs5('const x = () => 1;'), /not valid ES5/);
  assert.doesNotThrow(() => assertEs5('var x = function () { return 1; };'));
});

test('lowers modern syntax to ES5', async () => {
  const out = await toEs5('const f = (a, ...r) => `${a}:${r.length}`; class A { m() { return [...[1]]; } }');
  assert.doesNotThrow(() => assertEs5(out));
});

test('buildAll writes app folders and apps.js', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mzd-'));
  await buildAll(EXAMPLES, out);
  assert.ok(fs.existsSync(path.join(out, 'app.hola/app.js')));
  assert.ok(fs.existsSync(path.join(out, 'app.clima/app.js')));
  const list = fs.readFileSync(path.join(out, 'apps.js'), 'utf8');
  assert.match(list, /var CustomApplications = \[/);
  assert.match(list, /"app\.hola"/);
  fs.rmSync(out, { recursive: true, force: true });
});
