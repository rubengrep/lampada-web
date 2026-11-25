// Lampada web viewer: genera dist/lampada.html, un file solo con dentro tutto (codice, stili, icone, sql-wasm).
// Si apre con un doppio clic in Edge o Chrome, anche da una cartella di OneDrive.
//
// Il codice di Lampada (il plugin) arriva da:
//   - LAMPADA_DIR=/percorso/del/plugin node scripts/build.js   (una cartella, anche con modifiche non salvate)
//   - LAMPADA_TAG=0.22.0 node scripts/build.js                   (quella versione, scaricata da GitHub)
//   - altrimenti il tag "lampada" di package.json, scaricato da GitHub in ~/.cache/lampada-web.
// Le librerie che servono solo qui (markdown, YAML, icone, esbuild) stanno anche loro in ~/.cache/lampada-web.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const cache = path.join(os.homedir(), '.cache', 'lampada-web');
const mods = path.join(cache, 'node_modules');
const DEPS = Object.entries(pkg.buildDeps).map(([n, v]) => `${n}@${v}`);

const have = (d) => {
  const [name, ver] = d.split(/(?<=.)@/);
  try {
    return JSON.parse(fs.readFileSync(path.join(mods, name, 'package.json'), 'utf8')).version === ver;
  } catch (e) {
    return false;
  }
};
if (!DEPS.every(have)) {
  fs.mkdirSync(cache, { recursive: true });
  if (!fs.existsSync(path.join(cache, 'package.json'))) fs.writeFileSync(path.join(cache, 'package.json'), '{"private":true}');
  execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', ...DEPS], { cwd: cache, stdio: 'inherit' });
}
const esbuild = require(path.join(mods, 'esbuild'));

let lampada = process.env.LAMPADA_DIR && path.resolve(process.env.LAMPADA_DIR);
const tag = process.env.LAMPADA_TAG || pkg.lampada;
if (!lampada) {
  lampada = path.join(cache, `lampada-${tag}`);
  if (!fs.existsSync(path.join(lampada, 'manifest.json'))) {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', tag, 'https://github.com/rubengrep/lampada.git', lampada], { stdio: 'inherit' });
  }
}
if (!fs.existsSync(path.join(lampada, 'src', 'main.js'))) throw new Error(`Lampada non trovato in ${lampada}`);

// Icone: quelle di Obsidian sono di Lucide. Si prendono i nomi che compaiono come testo nel codice.
const iconDir = path.join(mods, 'lucide-static', 'icons');
const js = (d) => fs.readdirSync(d, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(d, f), 'utf8'));
const code = [...js(path.join(lampada, 'src')), ...js(path.join(root, 'src'))].join('\n');
const icons = {};
for (const [, n] of code.matchAll(/['"`]([a-z][a-z0-9-]*)['"`]/g)) {
  const f = path.join(iconDir, `${n}.svg`);
  if (!icons[n] && fs.existsSync(f)) icons[n] = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
}

(async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src', 'avvio.js')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    nodePaths: [mods],
    alias: { obsidian: path.join(root, 'src', 'obsidian.js'), lampada: lampada },
    loader: { '.txt': 'text', '.md': 'text', '.wasm': 'base64', '.css': 'text' },
    plugins: [
      {
        name: 'icone',
        setup(b) {
          b.onResolve({ filter: /^lmp-icons$/ }, () => ({ path: 'lmp-icons', namespace: 'icone' }));
          b.onLoad({ filter: /.*/, namespace: 'icone' }, () => ({ contents: JSON.stringify(icons), loader: 'json' }));
        },
      },
    ],
    logLevel: 'warning',
  });

  const bundle = result.outputFiles[0].text.replace(/<\/(script)/gi, '<\\/$1');
  const { version } = JSON.parse(fs.readFileSync(path.join(lampada, 'manifest.json'), 'utf8'));
  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Lampada web ${version}">
<title>Lampada</title>
</head>
<body>
<script>${bundle}</script>
</body>
</html>
`;
  const out = path.join(root, 'dist', 'lampada.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`dist/lampada.html: ${(html.length / 1e6).toFixed(1)} MB, Lampada ${version}, ${Object.keys(icons).length} icone`);
})().catch(() => process.exit(1));
