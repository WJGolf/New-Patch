// Rule tests for the release filter. Inputs are hand-written GitHub API objects (shape copied from the real
// WJGolf/New-Patch API response) to reach cases the live repo does not have today (pre-release, bad URL, hash mismatch).
// The live data is tested separately in github-live.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRelease, buildSiteData, applyLiveReleases, fileNameHasVersion, parseNotes, classifyAsset, isTrustedDownloadUrl, compareVersions,
} from '../src/assets/js/releases-core.js';

const repo = 'WJGolf/New-Patch';
const asset = (tag, name, extra = {}) => ({
  name, size: 1000, state: 'uploaded', digest: 'sha256:' + 'a'.repeat(64),
  browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}`, updated_at: '2026-11-12T18:00:00Z', ...extra,
});
const release = (tag, assets, extra = {}) => ({
  tag_name: tag, name: `RAMFLOW ${tag.slice(1)}`, draft: false, prerelease: false, published_at: '2026-11-12T18:27:13Z',
  body: 'Managed by RAMFLOW ADMIN.', assets, ...extra,
});

test('drafts, ADMIN data/feed releases and pre-releases are never shown', () => {
  assert.equal(normalizeRelease(release('v1.1.0', [asset('v1.1.0', 'RAMFLOW-1.1.0-x64.msi')], { draft: true, published_at: null }), { repo }), null);
  assert.equal(normalizeRelease(release('ramflow-feed', [asset('ramflow-feed', 'releases.json')]), { repo }), null);
  assert.equal(normalizeRelease(release('ramflow-admin', [], { draft: true }), { repo }), null);
  const pre = release('v2.0.0', [asset('v2.0.0', 'RAMFLOW-2.0.0-x64.msi')], { prerelease: true });
  assert.equal(normalizeRelease(pre, { repo }), null);
  assert.equal(normalizeRelease(pre, { repo, includePrereleases: true }).version, '2.0.0');
});

test('a file whose name states another version is rejected (the real v1.0.2 case)', () => {
  const r = normalizeRelease(release('v1.0.2', [asset('v1.0.2', 'RAMFLOW-1.0.1-win-x64-portable.zip')]), { repo });
  assert.equal(r.downloadable, false);
  assert.deepEqual(r.rejected.map(x => x.reason), ['version-mismatch']);
});

test('download URL must be the public GitHub URL of this repo, tag and file', () => {
  assert.ok(isTrustedDownloadUrl(`https://github.com/${repo}/releases/download/v1.0.1/RAMFLOW-1.0.1-x64.msi`, repo, 'v1.0.1', 'RAMFLOW-1.0.1-x64.msi'));
  for (const bad of [
    `http://github.com/${repo}/releases/download/v1.0.1/RAMFLOW-1.0.1-x64.msi`,
    `https://evil.example/${repo}/releases/download/v1.0.1/RAMFLOW-1.0.1-x64.msi`,
    `https://github.com/Other/Repo/releases/download/v1.0.1/RAMFLOW-1.0.1-x64.msi`,
    `https://github.com/${repo}/releases/download/v1.0.0/RAMFLOW-1.0.1-x64.msi`,
    `https://github.com/${repo}/releases/download/untagged-2b04/RAMFLOW-1.0.1-x64.msi`,
    `https://github.com/${repo}/releases/download/v1.0.1/RAMFLOW-1.0.1-x64.msi?x=1`,
  ]) assert.equal(isTrustedDownloadUrl(bad, repo, 'v1.0.1', 'RAMFLOW-1.0.1-x64.msi'), false, bad);
  const r = normalizeRelease(release('v1.0.1', [asset('v1.0.1', 'RAMFLOW-1.0.1-x64.msi', { browser_download_url: 'https://evil.example/x.msi' })]), { repo });
  assert.deepEqual(r.rejected.map(x => x.reason), ['bad-url']);
});

test('SHA-256 / size must match the signed ADMIN catalog when both exist', () => {
  const feedRelease = { version: '1.0.1', notes: {}, packages: [
    { fileName: 'RAMFLOW-1.0.1-x64.msi', size: 1000, sha256: 'B'.repeat(64) },
    { fileName: 'RAMFLOW-1.0.1-win-x64-portable.zip', size: 999, sha256: 'A'.repeat(64) },
  ] };
  const r = normalizeRelease(release('v1.0.1', [
    asset('v1.0.1', 'RAMFLOW-1.0.1-x64.msi'), asset('v1.0.1', 'RAMFLOW-1.0.1-win-x64-portable.zip'),
  ]), { repo, feedRelease });
  assert.deepEqual(r.rejected.map(x => x.reason).sort(), ['hash-mismatch', 'size-mismatch']);
  assert.equal(r.downloadable, false);
});

test('unfinished uploads, ADMIN/server packages and patches are not offered', () => {
  const r = normalizeRelease(release('v1.0.1', [
    asset('v1.0.1', 'RAMFLOW-1.0.1-x64.msi', { state: 'starter' }),
    asset('v1.0.1', 'RAMFLOW-ADMIN-1.0.1-win-x64.zip'),
    asset('v1.0.1', 'RAMFLOW-UpdateServer-1.0.1-win-x64.zip'),
    asset('v1.0.1', 'RAMFLOW-1.0.0-to-1.0.1.rfpatch'),
    asset('v1.0.1', 'RAMFLOW-1.0.1-win-x64-portable.zip'),
  ]), { repo });
  assert.deepEqual(r.assets.map(a => a.name), ['RAMFLOW-1.0.1-win-x64-portable.zip']);
  assert.deepEqual(r.rejected.map(x => x.reason), ['not-uploaded']);
});

test('installer is listed first, then portable', () => {
  const r = normalizeRelease(release('v1.0.1', [asset('v1.0.1', 'RAMFLOW-1.0.1-win-x64-portable.zip'), asset('v1.0.1', 'RAMFLOW-1.0.1-x64.msi')]), { repo });
  assert.deepEqual(r.assets.map(a => a.kind), ['installer', 'portable']);
  assert.equal(classifyAsset('notes.txt'), null);
});

test('version matching is exact', () => {
  assert.ok(fileNameHasVersion('RAMFLOW-1.0.1-x64.msi', '1.0.1'));
  assert.ok(fileNameHasVersion('RAMFLOW-1.0.1.msi', '1.0.1'));
  assert.ok(!fileNameHasVersion('RAMFLOW-1.0.10-x64.msi', '1.0.1'));
  assert.ok(!fileNameHasVersion('RAMFLOW-11.0.1-x64.msi', '1.0.1'));
  assert.ok(compareVersions('1.0.10', '1.0.9') > 0);
});

test('latest = newest version that has a verified file; sorted newest first', () => {
  const data = buildSiteData({ repo, generatedAt: 'x', catalog: null, ghReleases: [
    release('v1.0.1', [asset('v1.0.1', 'RAMFLOW-1.0.1-x64.msi')]),
    release('v1.0.2', [asset('v1.0.2', 'RAMFLOW-1.0.1-win-x64-portable.zip')]),
    release('v1.0.0', [asset('v1.0.0', 'RAMFLOW-1.0.0-x64.msi')]),
  ] });
  assert.deepEqual(data.releases.map(r => r.version), ['1.0.2', '1.0.1', '1.0.0']);
  assert.equal(data.latestVersion, '1.0.1');
});

test('notes come from the signed catalog; the ADMIN placeholder body is not a note', () => {
  const catalog = { releases: [{ version: '1.0.1', status: 'published', notes: { th: 'แก้ไข: ปุ่มค้าง' }, packages: [] }] };
  const data = buildSiteData({ repo, generatedAt: 'x', catalog, ghReleases: [
    release('v1.0.1', [asset('v1.0.1', 'RAMFLOW-1.0.1-x64.msi')]), release('v1.0.0', [asset('v1.0.0', 'RAMFLOW-1.0.0-x64.msi')]),
  ] });
  assert.deepEqual(data.releases[0].notes, { th: 'แก้ไข: ปุ่มค้าง' });
  assert.equal(data.releases[0].notesSource, 'admin');
  assert.deepEqual(data.releases[1].notes, {});
});

test('live check: withdrawn versions disappear, newly published versions appear', () => {
  const snapshot = buildSiteData({ repo, generatedAt: 'x', catalog: null, ghReleases: [
    release('v1.0.1', [asset('v1.0.1', 'RAMFLOW-1.0.1-x64.msi')]), release('v1.0.0', [asset('v1.0.0', 'RAMFLOW-1.0.0-x64.msi')]),
  ] });
  const live = applyLiveReleases(snapshot, [
    release('v1.0.3', [asset('v1.0.3', 'RAMFLOW-1.0.3-x64.msi')]),
    release('v1.0.0', [asset('v1.0.0', 'RAMFLOW-1.0.0-x64.msi')]),
  ]);
  assert.deepEqual(live.releases.map(r => r.version), ['1.0.3', '1.0.0']);
  assert.equal(live.latestVersion, '1.0.3');
  assert.equal(live.releases[0].fresh, true);
});

test('release notes are split into sections without inventing anything', () => {
  const s = parseNotes(`## New Features
- Auto Clean presets
Improved:
* Faster dashboard
Fixed: tray icon duplicated
[Security] Signed catalog checks
ข้อความทั่วไป`);
  assert.deepEqual(Object.fromEntries(s.map(x => [x.key, x.items])), {
    features: ['Auto Clean presets'],
    improvements: ['Faster dashboard', 'ข้อความทั่วไป'],
    fixes: ['tray icon duplicated'],
    security: ['Signed catalog checks'],
  });
  assert.deepEqual(parseNotes('RAMFLOW 1.0.1 - เวอร์ชันแรกที่มีศูนย์อัปเดต'), [{ key: 'notes', title: 'รายละเอียด', items: ['RAMFLOW 1.0.1 - เวอร์ชันแรกที่มีศูนย์อัปเดต'] }]);
  assert.deepEqual(parseNotes(''), []);
});

test('empty and error states never show a download button', async () => {
  const { renderLatestDownload, renderHeroRelease, renderVersionList } = await import('../src/assets/js/render.js');
  const empty = { repo, releases: [], latestVersion: null };
  for (const fn of [renderLatestDownload, renderHeroRelease, renderVersionList]) {
    assert.match(fn(empty), /ยังไม่มีเวอร์ชันที่เผยแพร่/);
    assert.doesNotMatch(fn(empty), /data-download/);
  }
  const failed = { ...empty, error: 'GitHub API 503' };
  assert.match(renderLatestDownload(failed), /โหลดข้อมูลเวอร์ชันไม่สำเร็จ[\s\S]*data-retry/);
  // A release whose only file was rejected: listed, but without a download button.
  const data = buildSiteData({ repo, generatedAt: 'x', catalog: null,
    ghReleases: [release('v1.0.2', [asset('v1.0.2', 'RAMFLOW-1.0.1-win-x64-portable.zip')])] });
  const html = renderVersionList(data);
  assert.match(html, /ไม่มีไฟล์ดาวน์โหลดที่ผ่านการตรวจสอบ/);
  assert.doesNotMatch(html, /data-download/);
  assert.match(renderLatestDownload(data), /ยังไม่มีเวอร์ชันที่เผยแพร่/);
});

test('release text is HTML-escaped', async () => {
  const { renderVersionList } = await import('../src/assets/js/render.js');
  const catalog = { releases: [{ version: '1.0.1', status: 'published', notes: { th: '<img src=x onerror=alert(1)>' }, packages: [] }] };
  const data = buildSiteData({ repo, generatedAt: 'x', catalog, ghReleases: [release('v1.0.1', [asset('v1.0.1', 'RAMFLOW-1.0.1-x64.msi')])] });
  const html = renderVersionList(data);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});
