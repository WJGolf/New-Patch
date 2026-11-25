// Builds the static RAMFLOW website into dist/ from src/ + the release data in .cache/releases.json.
//
//   node scripts/fetch-releases.mjs   # real data from GitHub (required first)
//   node scripts/build.mjs            # → dist/
//
// Env: SITE_URL — public URL of the site (CI passes the GitHub Pages URL); default: site.config.json "siteUrl".

import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  renderHeroRelease, renderLatestDownload, renderVersionList, renderChangelog, renderCta, renderJsonLd, esc,
} from '../src/assets/js/render.js';
import { formatDate } from '../src/assets/js/releases-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const PAGES = [
  { id: 'home', file: 'index.html', out: '', title: 'RAMFLOW — Smart RAM Cleaner & Memory Optimizer สำหรับ Windows',
    description: 'ดาวน์โหลด RAMFLOW โปรแกรมดูแล RAM สำหรับ Windows 10/11 ดูการใช้หน่วยความจำแบบเรียลไทม์ ล้าง Standby List ด้วย Microsoft RAMMap และล้างอัตโนมัติพร้อมระบบป้องกัน' },
  { id: 'download', file: 'download.html', out: 'download/', title: 'ดาวน์โหลด RAMFLOW เวอร์ชันล่าสุด',
    description: 'ดาวน์โหลด RAMFLOW เวอร์ชันล่าสุดจาก GitHub Releases อย่างเป็นทางการ พร้อม Release Notes ขนาดไฟล์ SHA-256 และความต้องการของระบบ' },
  { id: 'versions', file: 'versions.html', out: 'versions/', title: 'ประวัติเวอร์ชัน RAMFLOW',
    description: 'ทุกเวอร์ชันของ RAMFLOW ที่เผยแพร่แล้ว พร้อม Release Notes วันที่เผยแพร่ และไฟล์ดาวน์โหลดของแต่ละเวอร์ชัน' },
  { id: 'changelog', file: 'changelog.html', out: 'changelog/', title: 'Changelog — บันทึกการเปลี่ยนแปลงของ RAMFLOW',
    description: 'ฟีเจอร์ใหม่ การปรับปรุง การแก้ไขปัญหา และอัปเดตความปลอดภัยในแต่ละเวอร์ชันของ RAMFLOW' },
  { id: 'faq', file: 'faq.html', out: 'faq/', title: 'คำถามที่พบบ่อย — วิธีติดตั้ง อัปเดต และใช้งาน RAMFLOW',
    description: 'วิธีดาวน์โหลด ติดตั้ง อัปเดต ใช้ Auto Clean RAMMap คืออะไร และวิธีแก้เมื่อโปรแกรมเปิดไม่ได้หรืออัปเดตไม่ได้' },
  { id: '404', file: '404.html', out: '404.html', title: 'ไม่พบหน้านี้ — RAMFLOW', description: 'ไม่พบหน้าที่ต้องการบนเว็บไซต์ RAMFLOW — ไปที่หน้าดาวน์โหลดหรือหน้าแรก', noindex: true },
];

const read = p => readFile(path.join(ROOT, p), 'utf8');

function fill(template, values) {
  return template.replace(/\{\{([a-zA-Z0-9:_-]+)\}\}/g, (m, key) => (key in values ? values[key] : m));
}

function renderScreenshots(items) {
  if (!items?.length) return '';
  return `
<section class="section-tight" id="screenshots">
  <div class="container">
    <div class="section-head center reveal">
      <p class="eyebrow">Screenshots</p>
      <h2 class="section-title">หน้าตาของ RAMFLOW</h2>
    </div>
    <div class="shots">${items.map(s => `
      <figure class="card shot reveal"><img src="{{root}}assets/screenshots/${esc(s.file)}" alt="${esc(s.caption)}" width="${esc(s.width ?? '')}" height="${esc(s.height ?? '')}" loading="lazy" decoding="async"><figcaption>${esc(s.caption)}</figcaption></figure>`).join('')}
    </div>
  </div>
</section>`;
}

export async function build({ siteUrl: siteUrlArg } = {}) {
  const config = JSON.parse(await read('site.config.json'));
  let siteUrl = siteUrlArg || process.env.SITE_URL || config.siteUrl;
  if (!/^https?:\/\//.test(siteUrl)) throw new Error(`SITE_URL must be an absolute URL, got "${siteUrl}"`);
  if (!siteUrl.endsWith('/')) siteUrl += '/';
  const basePath = new URL(siteUrl).pathname; // "/" or "/New-Patch/"

  let data;
  try { data = JSON.parse(await read('.cache/releases.json')); }
  catch { throw new Error('No release data: run "node scripts/fetch-releases.mjs" first (it reads the real GitHub releases).'); }

  const layout = await read('src/partials/layout.html');
  const appWindow = await read('src/partials/app-window.html');
  const faq = JSON.parse(await read('content/faq.json')).items;
  const screenshots = JSON.parse(await read('content/screenshots.json')).items;

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await cp(path.join(SRC, 'assets'), path.join(DIST, 'assets'), { recursive: true });

  const assetVersion = createHash('sha256')
    .update(await read('src/assets/css/site.css')).update(await read('src/assets/js/site.js'))
    .update(await read('src/assets/js/render.js')).update(await read('src/assets/js/releases-core.js'))
    .digest('hex').slice(0, 10);

  const regions = {
    'region:hero': renderHeroRelease(data),
    'region:cta': renderCta(data),
    'region:latest': renderLatestDownload(data),
    'region:versions': renderVersionList(data),
    'region:changelog': renderChangelog(data),
  };
  const faqNav = faq.map(f => `<a href="#${esc(f.id)}">${esc(f.question)}</a>`).join('');
  const faqItems = faq.map((f, i) => `
        <details class="card faq" id="${esc(f.id)}"${i === 0 ? ' open' : ''}><summary>${esc(f.question)}</summary><div class="faq-body">${f.answer}</div></details>`).join('');
  const faqLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map(f => ({ '@type': 'Question', name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer.replace(/<[^>]+>/g, ' ').replace(/\{\{root\}\}/g, siteUrl).replace(/\s+/g, ' ').trim() } })),
  }).replace(/</g, '\\u003c');

  // Embedded snapshot (the browser starts from this and then checks GitHub live).
  const embedded = JSON.stringify(data).replace(/</g, '\\u003c');
  const generatedAtText = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })
    .format(new Date(data.generatedAt));

  for (const page of PAGES) {
    const depth = page.out.endsWith('/') ? page.out.split('/').length - 1 : 0;
    const root = page.id === '404' ? basePath : depth ? '../'.repeat(depth) : './';
    let content = await read(`src/pages/${page.file}`);
    content = fill(content, { ...regions, appWindow, screenshots: renderScreenshots(screenshots), faqNav, faqItems });

    let head = '';
    if (page.id === 'home' || page.id === 'download') head += `<script type="application/ld+json">${renderJsonLd(data, siteUrl)}</script>`;
    if (page.id === 'faq') head += `<script type="application/ld+json">${faqLd}</script>`;

    const nav = Object.fromEntries(['home', 'download', 'versions', 'changelog', 'faq']
      .map(id => [`nav:${id}`, id === page.id ? 'aria-current="page"' : '']));
    let html = fill(layout, {
      content, head, ...nav,
      title: esc(page.title), description: esc(page.description),
      canonical: esc(new URL(page.id === '404' ? '' : page.out, siteUrl).href),
      robots: page.noindex ? 'noindex' : 'index, follow',
      ogImage: esc(new URL('assets/img/og-image.png', siteUrl).href),
      themeColor: esc(config.themeColor), page: page.id,
    });
    html = fill(html, {
      root, assetVersion, year: String(new Date(data.generatedAt).getFullYear()),
      supportUrl: esc(config.supportUrl), supportLabel: esc(config.supportLabel), repo: esc(config.githubRepo),
      generatedAtText: esc(generatedAtText),
    });
    const leftover = html.replace('{{data}}', '').match(/\{\{[a-zA-Z0-9:_-]+\}\}/g);
    if (leftover) throw new Error(`${page.file}: unresolved placeholders ${[...new Set(leftover)].join(', ')}`);
    html = html.replace('{{data}}', () => embedded); // last, so release text can never be treated as a placeholder

    const outFile = page.out.endsWith('/') || page.out === '' ? path.join(DIST, page.out, 'index.html') : path.join(DIST, page.out);
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, html);
  }

  // Public data file, sitemap, robots.
  await mkdir(path.join(DIST, 'data'), { recursive: true });
  await writeFile(path.join(DIST, 'data', 'releases.json'), JSON.stringify(data, null, 2));
  const lastRelease = data.releases.map(r => r.publishedAt).sort().pop();
  const lastmod = (lastRelease ?? data.generatedAt).slice(0, 10);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.filter(p => !p.noindex).map(p => `  <url><loc>${esc(new URL(p.out, siteUrl).href)}</loc><lastmod>${lastmod}</lastmod><priority>${p.id === 'home' ? '1.0' : p.id === 'download' ? '0.9' : '0.7'}</priority></url>`).join('\n')}
</urlset>
`;
  await writeFile(path.join(DIST, 'sitemap.xml'), sitemap);
  await writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: ${basePath}data/\n\nSitemap: ${new URL('sitemap.xml', siteUrl).href}\n`);
  await writeFile(path.join(DIST, '.nojekyll'), '');

  const files = await countFiles(DIST);
  console.log(`Built ${PAGES.length} pages (${files} files) → dist/  site: ${siteUrl}  latest: ${data.latestVersion ?? 'none'}  data: ${formatDate(data.generatedAt)}`);
  return { siteUrl, files };
}

async function countFiles(dir) {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) n += e.isDirectory() ? await countFiles(path.join(dir, e.name)) : 1;
  return n;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch(err => { console.error(`build failed: ${err.message}`); process.exit(1); });
}
