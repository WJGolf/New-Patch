// Fetches the PUBLISHED RAMFLOW releases from GitHub and the signed RAMFLOW ADMIN catalog,
// verifies the catalog signature and writes .cache/releases.json for the build.
//
//   node scripts/fetch-releases.mjs
//
// Env: GITHUB_TOKEN (optional, server side only — CI uses the workflow token; never shipped to the browser).
// Exit code 1 when GitHub cannot be read: CI then keeps the previously deployed site instead of publishing an empty one.

import { verify as cryptoVerify } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSiteData } from '../src/assets/js/releases-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FEED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

export async function loadConfig() {
  return JSON.parse(await readFile(path.join(ROOT, 'site.config.json'), 'utf8'));
}

function apiHeaders() {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ramflow-website-build' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function getJson(url, attempt = 1) {
  const res = await fetch(url, { headers: apiHeaders() });
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    throw new Error(`GitHub API rate limit reached (resets ${new Date(reset).toISOString()}). Set GITHUB_TOKEN or try later.`);
  }
  if (res.status >= 500 && attempt < 3) {
    await new Promise(r => setTimeout(r, 1500 * attempt));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return res.json();
}

/** All releases visible to the token. Drafts are only visible with a write token; they are filtered out later. */
export async function fetchGitHubReleases(repo) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await getJson(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('GitHub returned an unexpected release list');
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/** Verifies an ECDSA P-256 / SHA-256 (IEEE P1363) signed document exactly like RAMFLOW USER does. */
export function verifySignedDocument(doc, publicKeyPem) {
  try {
    if (!doc || typeof doc.payload !== 'string' || typeof doc.signature !== 'string') return null;
    if (doc.algorithm && doc.algorithm !== 'ECDSA-P256-SHA256') return null;
    const payload = Buffer.from(doc.payload, 'base64');
    const signature = Buffer.from(doc.signature, 'base64');
    const ok = cryptoVerify('sha256', payload, { key: publicKeyPem, dsaEncoding: 'ieee-p1363' }, signature);
    return ok ? JSON.parse(payload.toString('utf8').replace(/^﻿/, '')) : null;
  } catch {
    return null;
  }
}

/** The signed catalog from the public "ramflow-feed" release (the same file RAMFLOW USER reads). */
export async function fetchCatalog(ghReleases, config, publicKeyPem) {
  const feedRelease = ghReleases.find(r => r.tag_name === config.feedTag && !r.draft);
  const asset = feedRelease?.assets?.find(a => a.name === config.feedAsset && a.state === 'uploaded');
  if (!asset) return { catalog: null, info: { status: 'missing', message: 'ไม่พบไฟล์ releases.json ของ RAMFLOW ADMIN' } };

  const url = `https://github.com/${config.githubRepo}/releases/download/${config.feedTag}/${config.feedAsset}`;
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'ramflow-website-build' } });
  const finalHost = new URL(res.url).hostname;
  if (!res.ok || !FEED_HOSTS.has(finalHost)) {
    return { catalog: null, info: { status: 'unreachable', message: `ดาวน์โหลด releases.json ไม่สำเร็จ (HTTP ${res.status})` } };
  }
  let doc;
  try { doc = JSON.parse((await res.text()).replace(/^﻿/, '')); } catch { doc = null; }
  const catalog = verifySignedDocument(doc, publicKeyPem);
  if (!catalog || catalog.product !== 'RAMFLOW') {
    return { catalog: null, info: { status: 'invalid-signature', message: 'ลายเซ็นของ releases.json ไม่ถูกต้อง — ไม่ใช้ข้อมูลจากไฟล์นี้' } };
  }
  return {
    catalog,
    info: { status: 'verified', sequence: catalog.sequence ?? null, generatedAt: catalog.generatedAt ?? null, url },
  };
}

export async function fetchSiteData() {
  const config = await loadConfig();
  const publicKeyPem = await readFile(path.join(ROOT, config.publicKeyFile), 'utf8');
  const ghReleases = await fetchGitHubReleases(config.githubRepo);
  const { catalog, info } = await fetchCatalog(ghReleases, config, publicKeyPem);
  const data = buildSiteData({
    ghReleases, catalog, repo: config.githubRepo, includePrereleases: !!config.includePrereleases,
    generatedAt: new Date().toISOString(), feedInfo: info,
  });
  return { ...data, includePrereleases: !!config.includePrereleases, liveCheckMinutes: config.liveCheckMinutes ?? 5 };
}

async function main() {
  let data;
  try {
    data = await fetchSiteData();
  } catch (err) {
    // Default (and CI): fail, so a broken fetch never replaces the deployed site.
    // --allow-error: build a page that shows the error state; the browser then retries GitHub live.
    if (!process.argv.includes('--allow-error')) throw err;
    const config = await loadConfig();
    data = { schema: 1, product: 'RAMFLOW', repo: config.githubRepo, generatedAt: new Date().toISOString(), feed: null,
      recommendedVersion: null, latestVersion: null, releases: [], includePrereleases: !!config.includePrereleases,
      liveCheckMinutes: config.liveCheckMinutes ?? 5, error: `อ่านข้อมูลจาก GitHub ไม่สำเร็จ: ${err.message}` };
    console.warn(`WARNING: ${data.error} (building the error page because of --allow-error)`);
  }
  await mkdir(path.join(ROOT, '.cache'), { recursive: true });
  await writeFile(path.join(ROOT, '.cache', 'releases.json'), JSON.stringify(data, null, 2));
  console.log(`Repo ${data.repo}: ${data.releases.length} published version(s); latest downloadable: ${data.latestVersion ?? 'none'}`);
  console.log(`Signed catalog: ${data.feed?.status}${data.feed?.sequence ? ` (sequence ${data.feed.sequence})` : ''}`);
  for (const r of data.releases) {
    console.log(`  v${r.version}  ${r.publishedAt}  files: ${r.assets.map(a => a.name).join(', ') || '-'}`
      + (r.rejected.length ? `  REJECTED: ${r.rejected.map(x => `${x.name} (${x.reason})`).join(', ')}` : ''));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(`fetch-releases failed: ${err.message}`); process.exit(1); });
}
