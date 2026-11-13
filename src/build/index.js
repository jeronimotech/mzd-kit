// mzd-kit build pipeline:
//   esbuild (bundle, modern syntax) → swc (lower to ES5) → acorn (verify ES5) → app.js
// CSS imported from an app is scoped to [app="<id>"], autoprefixed for old WebKit,
// and inlined into app.js, so each app ships as a single file plus optional public/ assets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { transform as swcTransform } from '@swc/core';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import * as acorn from 'acorn';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SDK_ENTRY = path.resolve(HERE, '../sdk/index.js');

// What we believe the CMU's browser supports (WebKit ~537, 2013-2014 era).
export const CMU_BROWSERS = ['safari >= 6', 'chrome >= 28'];
const ENTRY_NAMES = ['app.js', 'app.mjs', 'app.ts', 'index.js', 'index.ts'];

/** Find app folders inside `dir` (or `dir` itself if it is an app). */
export function findApps(dir) {
  const abs = path.resolve(dir);
  if (entryOf(abs)) return [appInfo(abs)];
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && entryOf(path.join(abs, e.name)))
    .map((e) => appInfo(path.join(abs, e.name)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function entryOf(dir) {
  for (const n of ENTRY_NAMES) if (fs.existsSync(path.join(dir, n))) return path.join(dir, n);
  return null;
}

function appInfo(dir) {
  const base = path.basename(dir);
  const id = base.startsWith('app.') ? base : 'app.' + base;
  return { id, dir, entry: entryOf(dir), publicDir: path.join(dir, 'public') };
}

/** postcss plugin: prefix every selector with [app="id"] (`:root`/`html`/`body` become the app root). */
function scopeTo(id) {
  const scope = `[app="${id}"]`;
  return {
    postcssPlugin: 'mzd-scope',
    Rule(rule) {
      if (rule.__mzdScoped) return;
      let p = rule.parent;
      while (p) {
        if (p.type === 'atrule' && /keyframes$/i.test(p.name)) return;
        p = p.parent;
      }
      rule.selectors = rule.selectors.map((sel) => {
        const s = sel.trim();
        if (s.startsWith(scope)) return s;
        if (/^(:root|html|body)$/.test(s)) return scope;
        if (/^(:root|html|body)\s+/.test(s)) return s.replace(/^(:root|html|body)\s+/, scope + ' ');
        return scope + ' ' + s;
      });
      rule.__mzdScoped = true;
    },
  };
}
scopeTo.postcss = true;

export async function compileCss(css, id, from) {
  const result = await postcss([scopeTo(id), autoprefixer({ overrideBrowserslist: CMU_BROWSERS })]).process(css, { from });
  return result.css;
}

function cssPlugin(id) {
  return {
    name: 'mzd-css',
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = await compileCss(await fs.promises.readFile(args.path, 'utf8'), id, args.path);
        const key = id + ':' + path.basename(args.path);
        return {
          contents: `import { injectCss } from 'mzd-kit';\ninjectCss(${JSON.stringify(css)}, ${JSON.stringify(key)});`,
          loader: 'js',
          resolveDir: path.dirname(args.path),
          watchFiles: [args.path],
        };
      });
    },
  };
}

/** Throws a readable error if `code` is not valid ES5. */
export function assertEs5(code, file) {
  try {
    acorn.parse(code, { ecmaVersion: 5, sourceType: 'script' });
  } catch (e) {
    const lines = code.split('\n');
    const loc = e.loc ? `${e.loc.line}:${e.loc.column}` : '?';
    const snippet = e.loc ? (lines[e.loc.line - 1] || '').slice(Math.max(0, e.loc.column - 40), e.loc.column + 40) : '';
    const err = new Error(`${file || 'output'} is not valid ES5 at ${loc}: ${e.message}\n  …${snippet}…`);
    err.code = 'NOT_ES5';
    throw err;
  }
}

/** Lower bundled code to ES5 and verify it. */
export async function toEs5(code, { minify = false, file } = {}) {
  const out = await swcTransform(code, {
    filename: file || 'app.js',
    isModule: false,
    sourceMaps: false,
    minify,
    jsc: {
      target: 'es5',
      loose: true,
      parser: { syntax: 'ecmascript' },
      minify: minify ? { compress: { ecma: 5 }, mangle: true, format: { ecma: 5 } } : undefined,
    },
  });
  assertEs5(out.code, file);
  return out.code;
}

/**
 * Build one app.
 * @returns {Promise<{id: string, code: string, bytes: number}>}
 */
export async function buildApp(app, { minify = false } = {}) {
  let result;
  try {
    result = await bundle(app);
  } catch (e) {
    const msg = String(e.message || e);
    if (/async functions|generator/i.test(msg)) {
      const loc = (msg.match(/\S+:\d+:\d+/) || [''])[0];
      throw new Error(`${loc} async/await and generators can't run on the CMU's browser. Use callbacks instead (e.g. app.net.get(url, (err, data) => …)).`);
    }
    throw e;
  }
  const bundled = result.outputFiles[0].text;
  const es5 = await toEs5(bundled, { minify, file: `${app.id}/app.js` });
  const code = `/* ${app.id} — built with mzd-kit (https://github.com/jeronimotech/mzd-kit) */\n${es5}`;
  return { id: app.id, code, bytes: Buffer.byteLength(code) };
}

function bundle(app) {
  return esbuild.build({
    entryPoints: [app.entry],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2017',
    platform: 'browser',
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
    alias: { 'mzd-kit': SDK_ENTRY },
    define: { __MZD_APP_ID__: JSON.stringify(app.id) },
    plugins: [cssPlugin(app.id)],
    supported: { 'async-await': false, generator: false },
  });
}

/** Copy public/ assets of an app into outDir/<id>/. */
export function copyPublic(app, outDir) {
  if (!fs.existsSync(app.publicDir)) return;
  fs.cpSync(app.publicDir, path.join(outDir, app.id), { recursive: true });
}

/** Production build of all apps in `srcDir` into `outDir`. */
export async function buildAll(srcDir, outDir, { minify = true } = {}) {
  const apps = findApps(srcDir);
  if (!apps.length) throw new Error(`No apps found in ${srcDir} (an app is a folder with app.js)`);
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const app of apps) {
    const r = await buildApp(app, { minify });
    const dest = path.join(outDir, app.id);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    copyPublic(app, outDir);
    fs.writeFileSync(path.join(dest, 'app.js'), r.code);
    results.push(r);
  }
  // CASDK app list (the host loads apps/<id>/app.js for each entry)
  fs.writeFileSync(
    path.join(outDir, 'apps.js'),
    `var CustomApplications = [\n${apps.map((a) => `  "${a.id}",`).join('\n')}\n];\n`
  );
  return results;
}
