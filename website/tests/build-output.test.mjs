// Checks the built site in dist/ (run "node scripts/build.mjs" first): SEO tags, no secrets, no fake downloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
async function files(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out.push(...(e.isDirectory() ? await files(p) : [p]));
  }
  return out;
}
const all = await files(DIST);
const stripData = s => s.replace(/<script type="application\/json" id="release-data">[\s\S]*?<\/script>/, '');
const html = await Promise.all(all.filter(f => f.endsWith('.html')).map(async f => ({ f: path.relative(DIST, f), s: stripData(await readFile(f, 'utf8')) })));
const data = JSON.parse(await readFile(path.join(DIST, 'data', 'releases.json'), 'utf8'));

test('every page has title, description, canonical, Open Graph and no unresolved placeholders', () => {
  assert.equal(html.length, 6);
  for (const { f, s } of html) {
    assert.match(s, /<title>[^<]{10,}<\/title>/, f);
    assert.match(s, /<meta name="description" content="[^"]{20,}">/, f);
    assert.match(s, /<link rel="canonical" href="https?:\/\/[^"]+">/, f);
    for (const p of ['og:title', 'og:description', 'og:url', 'og:image']) assert.ok(s.includes(`property="${p}"`), `${f} ${p}`);
    assert.ok(!/\{\{[a-zA-Z0-9:_-]+\}\}/.test(s.replace(/<script type="application\/json" id="release-data">[\s\S]*?<\/script>/, '')), `${f} placeholder`);
  }
});

test('sitemap and robots exist and point to the site', async () => {
  const sitemap = await readFile(path.join(DIST, 'sitemap.xml'), 'utf8');
  const robots = await readFile(path.join(DIST, 'robots.txt'), 'utf8');
  assert.equal((sitemap.match(/<loc>/g) || []).length, 5);
  assert.match(robots, /Sitemap: https?:\/\/\S+sitemap\.xml/);
  assert.ok(all.some(f => f.endsWith('og-image.png')), 'og-image.png missing');
});

test('no token or secret is shipped', async () => {
  for (const f of all.filter(f => /\.(html|js|css|json|txt|xml)$/.test(f))) {
    const s = await readFile(f, 'utf8');
    assert.ok(!/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|BEGIN (EC |RSA )?PRIVATE KEY|Authorization:\s*Bearer)/.test(s), f);
  }
  assert.ok(!all.some(f => /admin-db\.json|signing-key|\.pem$/.test(f)));
});

test('every download link on every page is a verified file from the data', () => {
  const allowed = new Set(data.releases.flatMap(r => r.assets.map(a => a.url)));
  for (const { f, s } of html) {
    for (const m of s.matchAll(/<a [^>]*href="([^"]+)"[^>]*data-download/g)) assert.ok(allowed.has(m[1].replace(/&amp;/g, '&')), `${f}: ${m[1]}`);
    assert.ok(!/releases\/download\/(ramflow-feed|ramflow-admin|untagged-)/.test(s), f);
  }
  const home = html.find(h => h.f === 'index.html').s;
  if (data.latestVersion) assert.ok(home.includes(`ดาวน์โหลด RAMFLOW ${data.latestVersion}`));
});
