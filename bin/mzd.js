#!/usr/bin/env node
// mzd — the mzd-kit command line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const HELP = `mzd-kit ${pkg.version} — build apps for the Mazda Connect infotainment system

Usage:
  mzd create <app.name> [--title "My App"]   Create a new app from the template
  mzd dev [apps-dir] [--port 5173]          Run the simulator with live reload (default dir: .)
  mzd build [apps-dir] [--out dist]         Build ES5 bundles for the car (+ apps.js list)
  mzd check <file.js>                       Verify a JS file is valid ES5 (runs on the CMU)
  mzd bridge [--port 7070] [--host 0.0.0.0] Run the internet bridge for the car

Options:
  -h, --help       Show this help
  -v, --version    Show version

Docs: https://github.com/jeronimotech/mzd-kit`;

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function fail(msg) {
  console.error(c.err('✗ ') + msg);
  process.exit(1);
}

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    port: { type: 'string', short: 'p' },
    host: { type: 'string' },
    out: { type: 'string', short: 'o' },
    title: { type: 'string', short: 't' },
    token: { type: 'string' },
    'no-minify': { type: 'boolean' },
  },
});

const [cmd, ...args] = positionals;

if (opts.version) { console.log(pkg.version); process.exit(0); }
if (opts.help || !cmd) { console.log(HELP); process.exit(0); }

const commands = {
  async create() {
    const name = args[0];
    if (!name) fail('Usage: mzd create <app.name>');
    const base = path.basename(name);
    if (!/^[a-z0-9][a-z0-9.\-_]*$/i.test(base)) fail('App names may only contain letters, numbers, ".", "-" and "_"');
    const dir = path.resolve(path.dirname(name), base.startsWith('app.') ? base : 'app.' + base);
    if (fs.existsSync(dir)) fail(`${dir} already exists`);
    const title = opts.title || base.replace(/^app\./, '').replace(/[-_.]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    fs.cpSync(path.join(ROOT, 'templates/app'), dir, { recursive: true });
    const entry = path.join(dir, 'app.js');
    fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8').replace('__TITLE__', title.replace(/'/g, "\\'")));
    console.log(c.ok('✓ ') + `Created ${c.bold(path.relative(process.cwd(), dir) || dir)}`);
    console.log(c.dim(`  next: mzd dev ${path.relative(process.cwd(), path.dirname(dir)) || '.'}`));
  },

  async dev() {
    const { startSim } = await import('../src/sim/server.js');
    const sim = await startSim({
      appsDir: args[0] || '.',
      port: Number(opts.port || 5173),
      host: opts.host || '127.0.0.1',
      log: (m) => console.log(c.dim(m)),
    });
    console.log(`\n${c.bold('mzd-kit simulator')}  ${c.ok(sim.url)}`);
    console.log(c.dim('Bridge mounted at /bridge · Ctrl+C to stop\n'));
  },

  async build() {
    const { buildAll } = await import('../src/build/index.js');
    const src = args[0] || '.';
    const out = path.resolve(opts.out || 'dist');
    const t = Date.now();
    try {
      const results = await buildAll(src, out, { minify: !opts['no-minify'] });
      for (const r of results) console.log(c.ok('✓ ') + `${r.id.padEnd(28)} ${(r.bytes / 1024).toFixed(1).padStart(6)} KB  ${c.dim('ES5 ✓')}`);
      console.log(c.dim(`\n${results.length} app(s) → ${path.relative(process.cwd(), out) || out}  (${Date.now() - t} ms)`));
      console.log(c.dim('Copy each app folder to the CMU apps dir and add its id to apps.js (see docs/INSTALL.md).'));
    } catch (e) {
      fail(e.message);
    }
  },

  async check() {
    const file = args[0];
    if (!file) fail('Usage: mzd check <file.js>');
    const { assertEs5 } = await import('../src/build/index.js');
    try {
      assertEs5(fs.readFileSync(file, 'utf8'), file);
      console.log(c.ok('✓ ') + `${file} is valid ES5`);
    } catch (e) {
      fail(e.message);
    }
  },

  async bridge() {
    const { startBridge } = await import('../src/bridge/index.js');
    const host = opts.host || '0.0.0.0';
    const port = Number(opts.port || 7070);
    const token = opts.token || process.env.MZD_BRIDGE_TOKEN;
    await startBridge({ port, host, token });
    console.log(`${c.bold('mzd-kit bridge')}  ${c.ok(`http://${host}:${port}`)}`);
    console.log(c.dim(token ? 'Token required (?token=… or X-MZD-Token)' : 'No token set: /v1/proxy is disabled on public interfaces (set MZD_BRIDGE_TOKEN)'));
  },
};

if (!commands[cmd]) fail(`Unknown command "${cmd}". Run mzd --help`);
await commands[cmd]();
