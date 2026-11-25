// Live tests against the REAL GitHub repository and the REAL signed RAMFLOW ADMIN catalog (network required).
// Skipped when RAMFLOW_SKIP_LIVE=1. With GITHUB_TOKEN set to a token that can see drafts, it also proves that
// draft releases are filtered out even when GitHub returns them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchGitHubReleases, fetchCatalog, verifySignedDocument, loadConfig, fetchSiteData } from '../scripts/fetch-releases.mjs';

const skip = process.env.RAMFLOW_SKIP_LIVE === '1';
const config = await loadConfig();
const pem = await readFile(new URL('../' + config.publicKeyFile, import.meta.url), 'utf8');

test('real signed catalog verifies with the RAMFLOW public key; a tampered copy does not', { skip }, async () => {
  const gh = await fetchGitHubReleases(config.githubRepo);
  const { catalog, info } = await fetchCatalog(gh, config, pem);
  assert.equal(info.status, 'verified');
  assert.equal(catalog.product, 'RAMFLOW');

  const res = await fetch(info.url);
  const doc = JSON.parse((await res.text()).replace(/^﻿/, ''));
  assert.ok(verifySignedDocument(doc, pem));
  const bytes = Buffer.from(doc.payload, 'base64');
  bytes[bytes.length - 5] ^= 1;
  assert.equal(verifySignedDocument({ ...doc, payload: bytes.toString('base64') }, pem), null);
  assert.equal(verifySignedDocument({ ...doc, signature: Buffer.alloc(64).toString('base64') }, pem), null);
});

test('real site data: only published v* releases, every file downloadable from GitHub', { skip }, async () => {
  const raw = await fetchGitHubReleases(config.githubRepo);
  const data = await fetchSiteData();
  const draftTags = raw.filter(r => r.draft).map(r => r.tag_name);
  console.log(`GitHub returned ${raw.length} releases (${draftTags.length} drafts visible: ${draftTags.join(', ') || 'none'})`);
  console.log(`Website shows: ${data.releases.map(r => `${r.version}[${r.assets.map(a => a.name).join(', ') || 'no files'}]`).join('; ')}`);

  for (const r of data.releases) {
    assert.match(r.tag, /^v\d+\.\d+\.\d+$/);
    assert.ok(!draftTags.includes(r.tag), `draft ${r.tag} must not be shown`);
    const ghr = raw.find(x => x.tag_name === r.tag);
    assert.equal(ghr.draft, false);
    assert.equal(ghr.prerelease, false);
  }
  assert.ok(!data.releases.some(r => r.tag === 'ramflow-feed' || r.tag === 'ramflow-admin'));

  // Every offered file must really be downloadable anonymously (GitHub answers 302 to its storage).
  for (const r of data.releases) for (const a of r.assets) {
    const res = await fetch(a.url, { method: 'HEAD', redirect: 'manual' });
    assert.ok([200, 302].includes(res.status), `${a.url} → HTTP ${res.status}`);
    if (res.status === 302) assert.match(new URL(res.headers.get('location')).hostname, /(^|\.)githubusercontent\.com$/);
  }
  if (data.latestVersion) {
    const latest = data.releases.find(r => r.version === data.latestVersion);
    assert.ok(latest.assets.length > 0);
  }
});
