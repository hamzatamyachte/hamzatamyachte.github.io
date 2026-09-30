// Builds the public site: minified copy of every game in games.json plus the games list page.
// Game sources are expected in src/<path> (the workflow clones them there).
import { readFile, writeFile, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';

const SRC = 'src';
const DIST = 'dist';
const BUILD_ID = (process.env.BUILD_ID || Date.now().toString(36)).slice(0, 8);

const htmlOptions = {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: { compress: true, mangle: true },
};

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function buildFile(from, to) {
  const ext = extname(from);
  if (!['.html', '.js', '.json'].includes(ext)) return copyFile(from, to);

  let code = await readFile(from, 'utf8');
  if (ext === '.html') {
    code = await minifyHtml(code, htmlOptions);
  } else if (ext === '.js') {
    // Give the service worker cache a per-build name so installed copies fetch the new files.
    if (from.endsWith('sw.js')) {
      code = code.replace(/const VERSION = '([^']+)'/, `const VERSION = '$1-${BUILD_ID}'`);
    }
    code = (await minifyJs(code, { compress: true, mangle: true })).code;
  } else {
    code = JSON.stringify(JSON.parse(code));
  }
  await writeFile(to, code);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function buildGame(game) {
  const srcDir = join(SRC, game.path);
  for (const file of await walk(srcDir)) {
    const rel = file.slice(srcDir.length + 1);
    if (rel === 'README.md' || rel === 'package.json' || rel.startsWith('node_modules')) continue;
    const to = join(DIST, game.path, rel);
    await mkdir(join(to, '..'), { recursive: true });
    await buildFile(file, to);
  }
}

async function buildIndex(games) {
  const cards = games.map(g => `
    <a class="game" href="${g.path}/">
      <img src="${g.path}/${g.icon}" alt="" width="72" height="72">
      <span class="text">
        <span class="name">${escapeHtml(g.name)}</span>
        <span class="desc">${escapeHtml(g.description)}</span>
      </span>
    </a>`).join('');
  const template = await readFile('site/index.html', 'utf8');
  const html = template.replace('<!--GAMES-->', cards);
  await writeFile(join(DIST, 'index.html'), await minifyHtml(html, htmlOptions));
}

const games = JSON.parse(await readFile('games.json', 'utf8'));
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
for (const game of games) {
  await buildGame(game);
  console.log(`built ${game.path}`);
}
await buildIndex(games);
console.log(`built index (${games.length} games, build ${BUILD_ID})`);
