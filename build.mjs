// Builds the public site: minified copy of every repo-backed item in site.json plus the home page.
// Sources are expected in src/<path> (the workflow clones them there).
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

async function buildItem(item) {
  const srcDir = join(SRC, item.path);
  for (const file of await walk(srcDir)) {
    const rel = file.slice(srcDir.length + 1);
    if (rel === 'README.md' || rel === 'package.json' || rel.startsWith('node_modules')) continue;
    const to = join(DIST, item.path, rel);
    await mkdir(join(to, '..'), { recursive: true });
    await buildFile(file, to);
  }
}

// Repo-backed items link to their built path, others to their own url.
function itemCard(item) {
  const href = item.repo ? `${item.path}/` : item.url;
  const icon = item.icon ? (item.repo ? `${item.path}/${item.icon}` : item.icon) : null;
  const external = item.repo ? '' : ' target="_blank" rel="noopener"';
  return `
    <a class="item" href="${escapeHtml(href)}"${external}>
      ${icon ? `<img src="${escapeHtml(icon)}" alt="" width="72" height="72">` : ''}
      <span class="text">
        <span class="name">${escapeHtml(item.name)}</span>
        ${item.description ? `<span class="desc">${escapeHtml(item.description)}</span>` : ''}
      </span>
    </a>`;
}

function sectionHtml(section) {
  return `
  <section id="${escapeHtml(section.id)}">
    <h2>${escapeHtml(section.title)}</h2>
    <div class="list">${section.items.map(itemCard).join('')}</div>
    ${section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : ''}
  </section>`;
}

async function buildIndex(site) {
  const template = await readFile('site/index.html', 'utf8');
  const html = template
    .replaceAll('{{title}}', escapeHtml(site.title))
    .replaceAll('{{tagline}}', escapeHtml(site.tagline || ''))
    .replace('<!--SECTIONS-->', site.sections.map(sectionHtml).join(''));
  await writeFile(join(DIST, 'index.html'), await minifyHtml(html, htmlOptions));
}

const site = JSON.parse(await readFile('site.json', 'utf8'));
const items = site.sections.flatMap(s => s.items);
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
for (const item of items.filter(i => i.repo)) {
  await buildItem(item);
  console.log(`built ${item.path}`);
}
await buildIndex(site);
console.log(`built index (${site.sections.length} sections, ${items.length} items, build ${BUILD_ID})`);
