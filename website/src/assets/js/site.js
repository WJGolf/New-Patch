// RAMFLOW website — browser behaviour: menu, reveal animation, copy buttons, download panel,
// and the live check of GitHub Releases (public API, no token) on top of the build snapshot.

import { applyLiveReleases, formatBytes, formatDate } from './releases-core.js';
import {
  renderHeroRelease, renderLatestDownload, renderVersionList, renderChangelog, renderCta,
} from './render.js';

const REPO_API = repo => `https://api.github.com/repos/${repo}/releases?per_page=100`;
const CACHE_KEY = 'ramflow.releases.v1';
const root = document.documentElement.dataset.root || './';

const REGIONS = {
  hero: renderHeroRelease,
  cta: renderCta,
  latest: renderLatestDownload,
  versions: renderVersionList,
  changelog: renderChangelog,
};

let snapshot = null;
let liveCheckMinutes = 5;

// ------------------------------------------------------------------ menu
const nav = document.querySelector('.nav');
const toggle = document.querySelector('.nav-toggle');
toggle?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
});

// ------------------------------------------------------------------ reveal on scroll
const revealables = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  revealables.forEach(el => io.observe(el));
} else {
  revealables.forEach(el => el.classList.add('in'));
}

// ------------------------------------------------------------------ copy / download / retry (delegated)
document.addEventListener('click', async e => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    e.preventDefault();
    const ok = await copyText(copy.dataset.copy);
    flash(copy, ok);
    return;
  }
  const dl = e.target.closest('a[data-download]');
  if (dl) { showDownloadPanel(dl); return; }
  if (e.target.closest('[data-retry]')) { e.preventDefault(); liveCheck({ force: true }); return; }
  if (e.target.closest('[data-toast-close]')) hideToast();
});

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.setAttribute('readonly', '');
    ta.className = 'sr-copy';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function flash(el, ok) {
  el.classList.add('copied');
  const old = el.getAttribute('title');
  el.setAttribute('title', ok ? 'คัดลอกแล้ว' : 'คัดลอกไม่สำเร็จ');
  if (el.classList.contains('link-btn')) {
    const text = el.textContent;
    el.textContent = ok ? 'คัดลอกแล้ว ✓' : 'คัดลอกไม่สำเร็จ';
    setTimeout(() => { el.textContent = text; }, 1600);
  }
  setTimeout(() => { el.classList.remove('copied'); if (old) el.setAttribute('title', old); }, 1600);
}

// The file itself is downloaded by the browser from GitHub (cross-origin, so the page cannot read its bytes);
// the panel shows what is being downloaded and how to verify it. Progress is shown by the browser's download bar.
const toast = document.querySelector('[data-toast]');
let toastTimer;
function showDownloadPanel(link) {
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.hidden = false;
  toast.classList.remove('done');
  toast.querySelector('[data-toast-title]').textContent = `กำลังดาวน์โหลด RAMFLOW ${link.dataset.version}`;
  toast.querySelector('[data-toast-file]').textContent = `${link.dataset.file} · ${formatBytes(link.dataset.size)}`;
  toast.querySelector('[data-toast-hash]').textContent = link.dataset.sha256 ? `SHA-256 ${link.dataset.sha256}` : '';
  requestAnimationFrame(() => toast.classList.add('show'));
  toastTimer = setTimeout(() => {
    toast.classList.add('done');
    toast.querySelector('[data-toast-title]').textContent = 'ส่งไฟล์ให้เบราว์เซอร์แล้ว';
  }, 3500);
  setTimeout(() => toast.classList.contains('done') && hideToast(), 14000);
}
function hideToast() {
  toast?.classList.remove('show');
}

// ------------------------------------------------------------------ release data
function readSnapshot() {
  try { return JSON.parse(document.getElementById('release-data')?.textContent || 'null'); }
  catch { return null; }
}

function render(data) {
  for (const el of document.querySelectorAll('[data-region]')) {
    const fn = REGIONS[el.dataset.region];
    if (!fn) continue;
    el.innerHTML = fn(data).replaceAll('{{root}}', root);
    el.classList.remove('is-updating');
  }
  openFromHash();
}

function setStatus(state, text) {
  const el = document.querySelector('[data-live-status]');
  if (!el) return;
  el.dataset.state = state;
  el.querySelector('span').textContent = text;
}

function timeText(d) {
  return new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(d);
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}
function writeCache(entry) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry)); } catch { /* private mode / quota */ }
}

/**
 * Asks GitHub which releases are public right now. Uses the browser's local cache for a few minutes and
 * ETag revalidation (a 304 does not count against GitHub's 60 requests/hour limit for anonymous visitors).
 * On any failure the page keeps showing the build snapshot.
 */
async function liveCheck({ force = false } = {}) {
  if (!snapshot?.repo) return;
  const cached = readCache();
  const fresh = cached && cached.repo === snapshot.repo && Date.now() - cached.at < liveCheckMinutes * 60_000;
  if (fresh && !force) { apply(cached.releases, new Date(cached.at)); return; }

  setStatus('checking', 'กำลังตรวจเวอร์ชันล่าสุดจาก GitHub…');
  if (force) document.querySelectorAll('[data-region]').forEach(el => el.classList.add('is-updating'));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const headers = { Accept: 'application/vnd.github+json' };
    if (cached?.etag && cached.repo === snapshot.repo) headers['If-None-Match'] = cached.etag;
    const res = await fetch(REPO_API(snapshot.repo), { headers, signal: ctrl.signal, cache: 'no-store' });
    if (res.status === 304 && cached) {
      writeCache({ ...cached, at: Date.now() });
      apply(cached.releases, new Date());
      return;
    }
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      throw new Error(reset ? `GitHub จำกัดจำนวนการเรียก ลองใหม่หลัง ${timeText(new Date(reset))}` : 'GitHub จำกัดจำนวนการเรียกชั่วคราว');
    }
    if (!res.ok) throw new Error(`GitHub ตอบกลับ ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('ข้อมูลจาก GitHub ไม่ถูกต้อง');
    // Keep only what the rules need; drafts are never returned to anonymous callers anyway.
    const releases = list.map(r => ({
      tag_name: r.tag_name, name: r.name, draft: r.draft, prerelease: r.prerelease, published_at: r.published_at, body: r.body,
      assets: (r.assets || []).map(a => ({ name: a.name, size: a.size, state: a.state, digest: a.digest,
        browser_download_url: a.browser_download_url, updated_at: a.updated_at })),
    }));
    writeCache({ repo: snapshot.repo, at: Date.now(), etag: res.headers.get('etag'), releases });
    apply(releases, new Date());
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'GitHub ตอบช้าเกินไป' : err.message;
    setStatus('offline', `แสดงข้อมูล ณ ${formatDate(snapshot.generatedAt)} ${timeText(new Date(snapshot.generatedAt))} · ${msg}`);
    if (snapshot.error) render(snapshot);
    document.querySelectorAll('[data-region]').forEach(el => el.classList.remove('is-updating'));
  } finally {
    clearTimeout(timer);
  }
}

function apply(ghReleases, when) {
  const merged = applyLiveReleases(snapshot, ghReleases, { includePrereleases: !!snapshot.includePrereleases });
  const before = JSON.stringify(snapshot.releases.map(r => [r.tag, r.assets.map(a => a.name)]));
  const after = JSON.stringify(merged.releases.map(r => [r.tag, r.assets.map(a => a.name)]));
  if (before !== after) render(merged);
  else document.querySelectorAll('[data-region]').forEach(el => el.classList.remove('is-updating'));
  setStatus('live', `ข้อมูลเวอร์ชันจาก GitHub Releases · ตรวจล่าสุด ${timeText(when)} น.`);
}

// Open the version that a link points to (e.g. versions/#v1.0.1).
function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = id ? document.getElementById(id) : null;
  const details = target?.matches('details') ? target : target?.querySelector('details');
  if (details) details.open = true;
}
addEventListener('hashchange', openFromHash);
openFromHash();

snapshot = readSnapshot();
if (snapshot) {
  liveCheckMinutes = snapshot.liveCheckMinutes || 5;
  if (document.querySelector('[data-region]')) {
    // Pages that show versions check right away; others do not spend the visitor's API quota.
    liveCheck();
  }
}
