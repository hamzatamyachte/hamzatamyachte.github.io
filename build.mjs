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
      ${icon ? `<img src="${escapeHtml(icon)}" alt="" width="44" height="44">` : ''}
      <span class="text">
        <span class="name">${escapeHtml(item.name)}</span>
        ${item.description ? `<span class="desc">${escapeHtml(item.description)}</span>` : ''}
      </span>
    </a>`;
}

// Section heading: icon tile, title and item count. On the collapsed side bar only the tile shows
// and the items open in a flyout next to it.
function groupHtml(section) {
  const items = section.items.filter(i => !i.unlisted);
  if (!items.length) return '';
  const title = escapeHtml(section.title);
  return `
  <div class="group" id="${escapeHtml(section.id)}">
    <button class="head" type="button" aria-expanded="true" title="${title}">
      <span class="tile">${ICONS[section.icon] || ICONS.apps}</span>
      <span class="label">${title}</span>
      <span class="count">${items.length}</span>
      ${ARROW}
    </button>
    <div class="fly">
      <p class="fly-title">${title}</p>
      <div class="list">${items.map(itemCard).join('')}</div>
    </div>
  </div>`;
}

// Side bar (wide screens) or list under the profile (phones).
function menuHtml(site) {
  return `
<nav class="menu" id="menu" aria-label="Games and apps">
  <button class="toggle" type="button" aria-controls="menu" aria-expanded="true" aria-label="Collapse menu" title="Collapse menu">${PANEL}</button>
  ${site.sections.map(groupHtml).join('')}
  ${site.tip ? `<p class="tip">${INFO}<span>${escapeHtml(site.tip)}</span></p>` : ''}
</nav>`;
}

const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  games: svg('<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59l-.02.15C2.6 9.42 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.42.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.55-.6-6.58-.69-7.26l-.01-.15A4 4 0 0 0 17.32 5z"/>'),
  apps: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>'),
};
const PANEL = svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>');
const ARROW = svg('<path d="M6 9l6 6 6-6"/>').replace('<svg', '<svg class="arrow"');
const PACKAGE = svg('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>');
const TERMINAL = svg('<path d="M4 17l6-6-6-6M12 19h8"/>');
const OUT = svg('<path d="M7 17L17 7M8 7h9v9"/>').replace('<svg', '<svg class="out"');
const INFO = svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>');
const PIN = svg('<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>');

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

// Plugin type from the frankenstyle prefix; anything else is development tooling.
const TYPES = { local: 'Local plugin', block: 'Block', mod: 'Activity', filter: 'Filter', enrol: 'Enrolment', availability: 'Availability', tool: 'Admin tool' };

function contributionsHtml(c) {
  if (!c || !c.items?.length) return '';
  const rows = c.items.map(i => {
    const type = TYPES[i.name.split('_')[0]];
    const owner = (i.url.match(/github\.com\/([^/]+)\//) || [])[1];
    return `
    <a class="repo${type ? '' : ' tooling'}" href="${escapeHtml(i.url)}" target="_blank" rel="noopener">
      <span class="tile">${type ? PACKAGE : TERMINAL}</span>
      <span class="text">
        <span class="name">${escapeHtml(i.name)}</span>
        <span class="kind">${escapeHtml([type || 'Tooling', owner].filter(Boolean).join(' · '))}</span>
        ${i.description ? `<span class="desc">${escapeHtml(i.description)}</span>` : ''}
      </span>
      ${OUT}
    </a>`;
  }).join('');
  return `<section id="contributions"><h2>${escapeHtml(c.title)} <span class="count">${c.items.length}</span></h2>
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
