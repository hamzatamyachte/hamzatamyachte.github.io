// Builds the public site from site.json: profile and contributions (main page), sections of items (menu) and a tip.
// Files in site/ other than index.html (the template) are copied to the site root.
// Item with `repo` + `path`: cloned into src/<path> by the workflow (SOURCES_TOKEN for private repos),
// minified here and served at /<path>/. Its repo sends a `source-updated` dispatch on push.
// Item with `url`: plain link card.
// Item with `unlisted: true`: still built and served at /<path>/, but left off the index page.
// Local build: npm ci, git clone <repo> src/<path>, npm run build (output in dist/).
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
    if (rel === 'README.md' || rel === 'package.json' || rel.startsWith('node_modules') || rel.startsWith('test/')) continue;
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
    <a class="item" href="${escapeHtml(href)}" title="${escapeHtml(item.name)}"${external}>
      ${icon ? `<img src="${escapeHtml(icon)}" alt="" width="52" height="52">` : ''}
      <span class="text">
        <span class="name">${escapeHtml(item.name)}</span>
        ${item.description ? `<span class="desc">${escapeHtml(item.description)}</span>` : ''}
      </span>
    </a>`;
}

function groupHtml(section) {
  const items = section.items.filter(i => !i.unlisted);
  if (!items.length) return '';
  return `
  <div class="group" id="${escapeHtml(section.id)}">
    <h2>${escapeHtml(section.title)}</h2>
    <div class="list">${items.map(itemCard).join('')}</div>
  </div>`;
}

// Side bar (wide screens) or list under the profile (phones).
function menuHtml(site) {
  return `
<nav class="menu" id="menu" aria-label="Games and apps">
  <button class="toggle" type="button" aria-controls="menu" aria-expanded="true" aria-label="Collapse menu" title="Collapse menu">${CHEVRON}</button>
  ${site.sections.map(groupHtml).join('')}
  ${site.tip ? `<p class="tip">${escapeHtml(site.tip)}</p>` : ''}
</nav>`;
}

const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

function heroHtml(profile) {
  const links = (profile.links || []).map(l =>
    `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener me">${escapeHtml(l.label)}</a>`).join('');
  return `
<header class="hero">
  ${profile.avatar ? `<img class="avatar" src="${escapeHtml(profile.avatar)}" alt="" width="128" height="128">` : ''}
  <div>
    <h1>${escapeHtml(profile.name)}</h1>
    ${profile.role ? `<p class="role">${escapeHtml(profile.role)}</p>` : ''}
    ${profile.location ? `<p class="meta">${PIN}${escapeHtml(profile.location)}</p>` : ''}
    ${links ? `<div class="links">${links}</div>` : ''}
  </div>
</header>`;
}

function contributionsHtml(c) {
  if (!c || !c.items?.length) return '';
  const rows = c.items.map(i => `
    <a class="repo" href="${escapeHtml(i.url)}" target="_blank" rel="noopener">
      <span class="name">${escapeHtml(i.name)}</span>
      ${i.description ? `<span class="desc">${escapeHtml(i.description)}</span>` : ''}
    </a>`).join('');
  return `<section id="contributions"><h2>${escapeHtml(c.title)}</h2>
    ${c.intro ? `<p class="intro">${escapeHtml(c.intro)}</p>` : ''}
    <div class="repos">${rows}</div></section>`;
}

function detailsHtml(profile, contributions) {
  const about = (profile.about || []).map(p => `<p>${escapeHtml(p)}</p>`).join('');
  const skills = (profile.skills || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  return `
<main class="details">
  ${about ? `<section><h2>About</h2>${about}</section>` : ''}
  ${skills ? `<section><h2>Skills</h2><ul class="chips">${skills}</ul></section>` : ''}
  ${contributionsHtml(contributions)}
</main>`;
}

async function buildIndex(site) {
  const profile = site.profile || { name: site.title };
  // Everything in site/ except the template is a static asset (avatar and the like).
  for (const entry of await readdir('site')) {
    if (entry !== 'index.html' && !entry.startsWith('.')) await copyFile(join('site', entry), join(DIST, entry));
  }
  const template = await readFile('site/index.html', 'utf8');
  const html = template
    .replaceAll('{{title}}', escapeHtml(site.title))
    .replaceAll('{{description}}', escapeHtml([profile.role, profile.location].filter(Boolean).join(', ')))
    .replaceAll('{{avatar}}', escapeHtml(profile.avatar || ''))
    .replace('<!--HERO-->', heroHtml(profile))
    .replace('<!--MENU-->', menuHtml(site))
    .replace('<!--DETAILS-->', detailsHtml(profile, site.contributions));
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
