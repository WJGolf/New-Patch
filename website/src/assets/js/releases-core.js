// RAMFLOW website — release data rules.
// Shared by the build (Node, scripts/fetch-releases.mjs) and the browser (site.js live check),
// so both apply exactly the same filters. No DOM and no Node APIs in this file.

export const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** Body text RAMFLOW ADMIN puts on every GitHub release; it is not a release note. */
export const ADMIN_PLACEHOLDER_BODY = 'Managed by RAMFLOW ADMIN.';

/** "1.2.3" or "v1.2.3" → [1,2,3]; anything else → null. */
export function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * Which files are RAMFLOW USER downloads. Files of RAMFLOW ADMIN, the Update Server, patches and the
 * ADMIN's own data/feed files are never offered on the website.
 */
export function classifyAsset(name) {
  const n = String(name ?? '');
  const lower = n.toLowerCase();
  if (/admin|updateserver|update-server/.test(lower)) return null;
  if (lower.endsWith('.msi')) {
    return { kind: 'installer', format: 'MSI', label: 'Installer (MSI)', order: 0,
      description: 'ติดตั้งลงเครื่อง มีทางลัดใน Start Menu และถอนการติดตั้งได้จาก Settings ของ Windows' };
  }
  if (lower.endsWith('.exe') && /setup|install/.test(lower)) {
    return { kind: 'installer', format: 'EXE', label: 'Installer (EXE)', order: 1,
      description: 'ตัวติดตั้งแบบ EXE' };
  }
  if (lower.endsWith('.zip') && /portable/.test(lower)) {
    return { kind: 'portable', format: 'ZIP', label: 'Portable Package (ZIP)', order: 2,
      description: 'แตกไฟล์แล้วเปิด RAMFLOW.exe ได้ทันที ไม่ต้องติดตั้ง' };
  }
  if (lower.endsWith('.zip') && /^ramflow/.test(lower)) {
    return { kind: 'package', format: 'ZIP', label: 'Full Package (ZIP)', order: 3,
      description: 'แพ็กเกจเต็มของ RAMFLOW USER' };
  }
  return null;
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** True if the file name states exactly this version (1.0.1 does not match 1.0.10 or 11.0.1). */
export function fileNameHasVersion(name, version) {
  return new RegExp(`(^|[^0-9.])${escapeRegExp(version)}([^0-9]|\\.[a-z]|$)`, 'i').test(String(name ?? ''));
}

/** The only download URL accepted for an asset: GitHub's public URL for this repo, tag and file. */
export function expectedDownloadUrl(repo, tag, name) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

export function isTrustedDownloadUrl(url, repo, tag, name) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.search || u.hash) return false;
  // GitHub encodes some characters differently from encodeURIComponent; compare decoded paths.
  const want = new URL(expectedDownloadUrl(repo, tag, name));
  return decodeURIComponent(u.pathname) === decodeURIComponent(want.pathname);
}

export const REJECT_REASONS = {
  'not-uploaded': 'ไฟล์ยังอัปโหลดไม่เสร็จ',
  'bad-url': 'ลิงก์ดาวน์โหลดไม่ใช่ลิงก์ของ Release นี้',
  'version-mismatch': 'ชื่อไฟล์ระบุเวอร์ชันไม่ตรงกับ Release นี้',
  'hash-mismatch': 'SHA-256 ไม่ตรงกับรายการที่ RAMFLOW ADMIN ลงนามไว้',
  'size-mismatch': 'ขนาดไฟล์ไม่ตรงกับรายการที่ RAMFLOW ADMIN ลงนามไว้',
};

function sha256FromDigest(digest) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(digest ?? ''));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Turns one item of GitHub's "list releases" API into a website release, or null when it must not be shown:
 * drafts, pre-releases (unless allowed) and releases whose tag is not "v<major>.<minor>.<patch>"
 * (e.g. RAMFLOW ADMIN's "ramflow-feed" and "ramflow-admin").
 * `feedRelease` is the matching entry of the signed RAMFLOW ADMIN catalog (verified), if any.
 */
export function normalizeRelease(gh, { repo, includePrereleases = false, feedRelease = null } = {}) {
  if (!gh || gh.draft) return null;
  if (gh.prerelease && !includePrereleases) return null;
  const tag = String(gh.tag_name ?? '');
  if (!VERSION_TAG.test(tag)) return null;
  if (!gh.published_at) return null;
  const version = tag.slice(1);

  const feedPackages = new Map((feedRelease?.packages ?? []).map(p => [p.fileName, p]));
  const assets = [];
  const rejected = [];
  for (const a of gh.assets ?? []) {
    const type = classifyAsset(a.name);
    if (!type) continue; // not a RAMFLOW USER download (feed, ADMIN data, patches…)
    let reason = null;
    const githubSha = sha256FromDigest(a.digest);
    const feedPkg = feedPackages.get(a.name);
    const feedSha = feedPkg?.sha256 ? String(feedPkg.sha256).toLowerCase() : null;
    if (a.state !== 'uploaded') reason = 'not-uploaded';
    else if (!isTrustedDownloadUrl(a.browser_download_url, repo, tag, a.name)) reason = 'bad-url';
    else if (!fileNameHasVersion(a.name, version)) reason = 'version-mismatch';
    else if (githubSha && feedSha && githubSha !== feedSha) reason = 'hash-mismatch';
    else if (feedPkg && Number(feedPkg.size) !== Number(a.size)) reason = 'size-mismatch';
    if (reason) { rejected.push({ name: a.name, reason, message: REJECT_REASONS[reason] }); continue; }
    assets.push({
      name: a.name,
      size: Number(a.size) || 0,
      sha256: githubSha ?? feedSha,
      url: expectedDownloadUrl(repo, tag, a.name),
      updatedAt: a.updated_at ?? null,
      ...type,
    });
  }
  assets.sort((x, y) => x.order - y.order || x.name.localeCompare(y.name));

  // Release notes: the signed ADMIN catalog first (ADMIN writes notes there), then the GitHub release body.
  const notes = {};
  let notesSource = 'none';
  for (const [lang, text] of Object.entries(feedRelease?.notes ?? {})) {
    if (typeof text === 'string' && text.trim()) { notes[lang] = text.trim(); notesSource = 'admin'; }
  }
  const body = String(gh.body ?? '').trim();
  if (notesSource === 'none' && body && body !== ADMIN_PLACEHOLDER_BODY) { notes.default = body; notesSource = 'github'; }

  return {
    version,
    tag,
    name: gh.name || `RAMFLOW ${version}`,
    publishedAt: gh.published_at,
    releaseDate: feedRelease?.releaseDate ?? null,
    prerelease: !!gh.prerelease,
    htmlUrl: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
    inSignedCatalog: !!feedRelease,
    notes,
    notesSource,
    assets,
    rejected,
    downloadable: assets.length > 0,
  };
}

/** Newest release that has at least one verified file; null when there is none. */
export function pickLatest(releases) {
  return [...releases].filter(r => r.downloadable).sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
}

/** The download offered on the big button: installer first, otherwise the portable/full package. */
export function primaryAsset(release) {
  return release?.assets?.[0] ?? null;
}

/**
 * Builds the website data from GitHub's release list and the (already verified) signed catalog.
 * `catalog` is null when the catalog is missing or its signature failed.
 */
export function buildSiteData({ ghReleases, catalog, repo, includePrereleases = false, generatedAt, feedInfo = null }) {
  const feedByVersion = new Map((catalog?.releases ?? [])
    .filter(r => String(r.status ?? 'published').toLowerCase() === 'published')
    .map(r => [r.version, r]));
  const seen = new Set();
  const releases = [];
  for (const gh of ghReleases ?? []) {
    const tag = String(gh?.tag_name ?? '');
    const r = normalizeRelease(gh, { repo, includePrereleases, feedRelease: feedByVersion.get(tag.slice(1)) ?? null });
    if (!r || seen.has(r.tag)) continue;
    seen.add(r.tag);
    releases.push(r);
  }
  releases.sort((a, b) => compareVersions(b.version, a.version));
  const latest = pickLatest(releases);
  return {
    schema: 1,
    product: 'RAMFLOW',
    repo,
    generatedAt,
    feed: feedInfo,
    recommendedVersion: catalog?.recommendedVersion ?? null,
    latestVersion: latest?.version ?? null,
    releases,
  };
}

/**
 * Browser live check: applies GitHub's current public release list on top of the build snapshot.
 * Versions no longer public on GitHub (withdrawn by ADMIN → draft) disappear; new public versions appear
 * (marked `fresh`, without signed-catalog data until the next website build).
 */
export function applyLiveReleases(snapshot, ghReleases, { includePrereleases = false } = {}) {
  const byTag = new Map(snapshot.releases.map(r => [r.tag, r]));
  const releases = [];
  for (const gh of ghReleases) {
    const tag = String(gh?.tag_name ?? '');
    if (byTag.has(tag)) {
      if (!gh.draft && (!gh.prerelease || includePrereleases)) releases.push(byTag.get(tag));
      continue;
    }
    const r = normalizeRelease(gh, { repo: snapshot.repo, includePrereleases });
    if (r) releases.push({ ...r, fresh: true });
  }
  releases.sort((a, b) => compareVersions(b.version, a.version));
  const latest = pickLatest(releases);
  return { ...snapshot, releases, latestVersion: latest?.version ?? null, live: true, error: null };
}

// ------------------------------------------------------------------ release notes

const SECTION_ALIASES = [
  ['features', 'ฟีเจอร์ใหม่', /^(new|new features?|features?|added|add|ใหม่|ฟีเจอร์ใหม่|ฟีเจอร์|เพิ่ม|เพิ่มใหม่|สิ่งใหม่)$/i],
  ['improvements', 'ปรับปรุง', /^(improved|improvements?|changed|changes|enhancements?|ปรับปรุง|การปรับปรุง|เปลี่ยนแปลง)$/i],
  ['fixes', 'แก้ไขปัญหา', /^(fixed|fix|fixes|bug ?fix(es)?|bugs?|แก้ไข|แก้บั๊ก|แก้ไขปัญหา|แก้ไขข้อผิดพลาด)$/i],
  ['security', 'ความปลอดภัย', /^(security|security updates?|ความปลอดภัย|อัปเดตความปลอดภัย)$/i],
];

export const SECTION_TITLES = Object.fromEntries(SECTION_ALIASES.map(([k, t]) => [k, t]));
SECTION_TITLES.notes = 'รายละเอียด';

function sectionOf(label) {
  const clean = String(label).trim().replace(/^#+\s*/, '').replace(/[:：]\s*$/, '').replace(/^\[|\]$/g, '').trim();
  for (const [key, , re] of SECTION_ALIASES) if (re.test(clean)) return key;
  return null;
}

/**
 * Splits free-text release notes into New Features / Improvements / Bug Fixes / Security.
 * Recognised: heading lines ("## Fixed", "Fixed:", "แก้ไข:") and prefixed items ("Fixed: …", "[New] …").
 * Text that is not under a recognised heading goes to "notes". Nothing is invented.
 */
export function parseNotes(text) {
  const sections = { features: [], improvements: [], fixes: [], security: [], notes: [] };
  let current = 'notes';
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^(#{1,6}\s*)?([^:：\n]{1,40}?)[:：]?\s*$/.exec(line);
    if (heading && (heading[1] || /[:：]$/.test(line)) && sectionOf(heading[2])) { current = sectionOf(heading[2]); continue; }
    let item = line.replace(/^([-*•+]|\d+[.)])\s+/, '');
    let target = current;
    const bracket = /^\[([^\]]{1,30})\]\s*(.+)$/.exec(item);
    const prefixed = /^([^:：]{1,30})[:：]\s*(.+)$/.exec(item);
    if (bracket && sectionOf(bracket[1])) { target = sectionOf(bracket[1]); item = bracket[2]; }
    else if (prefixed && sectionOf(prefixed[1])) { target = sectionOf(prefixed[1]); item = prefixed[2]; }
    sections[target].push(item);
  }
  return Object.entries(sections)
    .filter(([, items]) => items.length)
    .map(([key, items]) => ({ key, title: SECTION_TITLES[key], items }));
}

/** Notes to display: Thai first, then English, then whatever exists. */
export function notesText(release, lang = 'th') {
  const n = release?.notes ?? {};
  return n[lang] || n.th || n.en || n.default || Object.values(n)[0] || '';
}

// ------------------------------------------------------------------ formatting

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** Thai date in Buddhist era, e.g. "13 พ.ย. 2569". Uses the Asia/Bangkok calendar day. */
export function formatDate(iso, { long = false } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: long ? 'long' : 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
  }).format(d);
}

export function isoDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
