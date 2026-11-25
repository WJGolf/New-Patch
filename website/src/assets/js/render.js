// RAMFLOW website — HTML for release data. Used at build time (pre-rendered pages, SEO, no-JS)
// and in the browser (after the live GitHub check). Returns strings; every value is escaped.

import {
  formatBytes, formatDate, isoDate, notesText, parseNotes, primaryAsset, compareVersions,
} from './releases-core.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ICON = {
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" /></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>',
  github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" /></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>',
};
export { ICON };

function findLatest(data) {
  return data.releases.find(r => r.version === data.latestVersion) ?? null;
}

function versionBadges(release, data) {
  const out = [];
  if (release.version === data.latestVersion) out.push('<span class="badge badge-accent">ล่าสุด</span>');
  if (data.recommendedVersion && release.version === data.recommendedVersion && release.version !== data.latestVersion) {
    out.push('<span class="badge">แนะนำ</span>');
  }
  if (release.prerelease) out.push('<span class="badge badge-warn">Pre-release</span>');
  if (release.fresh) out.push('<span class="badge badge-info">เพิ่งเผยแพร่</span>');
  return out.join('');
}

/** Text of the release notes as paragraphs/list items (no markdown engine; only lines and bullets). */
export function renderNotesBody(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  let html = '', list = [];
  const flush = () => { if (list.length) { html += `<ul>${list.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`; list = []; } };
  for (const line of lines) {
    const bullet = /^([-*•+]|\d+[.)])\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (bullet) { list.push(bullet[2]); continue; }
    flush();
    html += heading ? `<h4>${esc(heading[1])}</h4>` : `<p>${esc(line)}</p>`;
  }
  flush();
  return html;
}

function notesBlock(release, { emptyText = 'ไม่มีบันทึกการเปลี่ยนแปลงสำหรับเวอร์ชันนี้' } = {}) {
  const body = renderNotesBody(notesText(release));
  return body ? `<div class="notes">${body}</div>` : `<p class="muted small">${esc(emptyText)}</p>`;
}

function downloadAttrs(release, asset) {
  return `href="${esc(asset.url)}" data-download data-version="${esc(release.version)}" data-file="${esc(asset.name)}"`
    + ` data-size="${esc(asset.size)}" data-sha256="${esc(asset.sha256 ?? '')}" rel="noopener"`;
}

function copyButton(value, label) {
  return `<button type="button" class="btn-icon" data-copy="${esc(value)}" aria-label="${esc(label)}" title="${esc(label)}">${ICON.copy}</button>`;
}

// ------------------------------------------------------------------ hero (home page)

export function renderHeroRelease(data) {
  const latest = findLatest(data);
  if (!latest) return renderEmpty(data, { compact: true });
  const asset = primaryAsset(latest);
  return `
    <div class="hero-actions">
      <a class="btn btn-primary btn-lg" ${downloadAttrs(latest, asset)}>
        ${ICON.download}<span>ดาวน์โหลด RAMFLOW ${esc(latest.version)}</span>
      </a>
      <a class="btn btn-ghost btn-lg" href="{{root}}download/">ตัวเลือกดาวน์โหลดทั้งหมด</a>
    </div>
    <dl class="hero-meta">
      <div><dt>เวอร์ชันล่าสุด</dt><dd><span class="mono">v${esc(latest.version)}</span> ${copyButton(latest.version, 'คัดลอกเลขเวอร์ชัน')}</dd></div>
      <div><dt>เผยแพร่เมื่อ</dt><dd><time datetime="${esc(isoDate(latest.publishedAt))}">${esc(formatDate(latest.publishedAt))}</time></dd></div>
      <div><dt>ขนาดไฟล์</dt><dd>${esc(formatBytes(asset.size))} <span class="muted">· ${esc(asset.format)}</span></dd></div>
      <div><dt>รองรับ</dt><dd>Windows 10 / 11 (64-bit)</dd></div>
    </dl>`;
}

// ------------------------------------------------------------------ download page

export function renderAssetRow(release, asset, { primary = false } = {}) {
  return `
    <li class="asset${primary ? ' asset-primary' : ''}">
      <div class="asset-icon">${ICON.file}</div>
      <div class="asset-main">
        <div class="asset-title">${esc(asset.label)}${primary ? ' <span class="badge badge-accent">แนะนำ</span>' : ''}</div>
        <div class="asset-desc">${esc(asset.description)}</div>
        <div class="asset-file mono">${esc(asset.name)} · ${esc(formatBytes(asset.size))}</div>
        ${asset.sha256 ? `<div class="asset-hash"><span class="mono" title="SHA-256">SHA-256 ${esc(asset.sha256)}</span>${copyButton(asset.sha256, 'คัดลอก SHA-256')}</div>` : ''}
      </div>
      <a class="btn ${primary ? 'btn-primary' : 'btn-secondary'}" ${downloadAttrs(release, asset)}>${ICON.download}<span>ดาวน์โหลด</span></a>
    </li>`;
}

export function renderLatestDownload(data) {
  const latest = findLatest(data);
  if (!latest) return renderEmpty(data);
  const asset = primaryAsset(latest);
  return `
    <article class="card card-glow latest">
      <header class="latest-head">
        <div>
          <p class="eyebrow">เวอร์ชันล่าสุด ${versionBadges(latest, data)}</p>
          <h2 class="latest-version">RAMFLOW <span class="text-accent">${esc(latest.version)}</span> ${copyButton(latest.version, 'คัดลอกเลขเวอร์ชัน')}</h2>
          <p class="muted">เผยแพร่เมื่อ <time datetime="${esc(isoDate(latest.publishedAt))}">${esc(formatDate(latest.publishedAt, { long: true }))}</time>
            · ${esc(latest.assets.length)} ไฟล์ · <a href="${esc(latest.htmlUrl)}" rel="noopener" target="_blank">ดูบน GitHub ${ICON.github}</a></p>
        </div>
        <a class="btn btn-primary btn-lg" ${downloadAttrs(latest, asset)}>${ICON.download}<span>ดาวน์โหลด ${esc(asset.format)} · ${esc(formatBytes(asset.size))}</span></a>
      </header>
      <div class="latest-grid">
        <section>
          <h3 class="h-sub">Release Notes</h3>
          ${notesBlock(latest)}
        </section>
        <section>
          <h3 class="h-sub">ไฟล์ในเวอร์ชันนี้</h3>
          <ul class="asset-list">${latest.assets.map((a, i) => renderAssetRow(latest, a, { primary: i === 0 })).join('')}</ul>
        </section>
      </div>
    </article>`;
}

// ------------------------------------------------------------------ version history

export function renderVersionList(data) {
  if (!data.releases.length) return renderEmpty(data);
  return `<ol class="timeline">${data.releases.map(r => renderVersionItem(r, data)).join('')}</ol>`;
}

function renderVersionItem(r, data) {
  const isLatest = r.version === data.latestVersion;
  const files = r.assets.length
    ? `<ul class="asset-list compact">${r.assets.map(a => renderAssetRow(r, a, { primary: false })).join('')}</ul>`
    : `<div class="callout callout-warn">${ICON.alert}<div><strong>ไม่มีไฟล์ดาวน์โหลดที่ผ่านการตรวจสอบ</strong>
         ${r.rejected.length ? `<ul class="small">${r.rejected.map(x => `<li><span class="mono">${esc(x.name)}</span> — ${esc(x.message)}</li>`).join('')}</ul>` : '<p class="small">Release นี้ยังไม่มีไฟล์ของ RAMFLOW USER</p>'}
       </div></div>`;
  return `
    <li class="timeline-item${isLatest ? ' is-latest' : ''}" id="v${esc(r.version)}">
      <span class="timeline-dot" aria-hidden="true"></span>
      <details class="card version"${isLatest ? ' open' : ''}>
        <summary>
          <span class="version-title">RAMFLOW <strong>${esc(r.version)}</strong> ${versionBadges(r, data)}</span>
          <span class="version-meta"><time datetime="${esc(isoDate(r.publishedAt))}">${esc(formatDate(r.publishedAt))}</time>
            · ${r.assets.length ? `${r.assets.length} ไฟล์` : 'ไม่มีไฟล์'}</span>
          <span class="chev">${ICON.chevron}</span>
        </summary>
        <div class="version-body">
          ${notesBlock(r)}
          ${files}
          <p class="small muted version-links">
            <button type="button" class="link-btn" data-copy="${esc(r.version)}">คัดลอกเลขเวอร์ชัน</button>
            · <a href="${esc(r.htmlUrl)}" target="_blank" rel="noopener">เปิด Release บน GitHub</a>
            · <a href="{{root}}changelog/#v${esc(r.version)}">ดูใน Changelog</a>
          </p>
        </div>
      </details>
    </li>`;
}

// ------------------------------------------------------------------ changelog

export function renderChangelog(data) {
  if (!data.releases.length) return renderEmpty(data);
  return data.releases.map(r => {
    const sections = parseNotes(notesText(r));
    const body = sections.length
      ? sections.map(s => `
          <section class="cl-section cl-${esc(s.key)}">
            <h4><span class="cl-dot"></span>${esc(s.title)}</h4>
            <ul>${s.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
          </section>`).join('')
      : '<p class="muted small">ไม่มีบันทึกการเปลี่ยนแปลงสำหรับเวอร์ชันนี้</p>';
    return `
      <article class="cl-entry" id="v${esc(r.version)}">
        <aside class="cl-side">
          <a class="cl-version" href="#v${esc(r.version)}">${esc(r.version)}</a>
          <time datetime="${esc(isoDate(r.publishedAt))}">${esc(formatDate(r.publishedAt, { long: true }))}</time>
          <div class="cl-badges">${versionBadges(r, data)}</div>
        </aside>
        <div class="card cl-card">${body}
          <p class="small muted cl-foot">${r.downloadable ? `<a href="{{root}}versions/#v${esc(r.version)}">ดาวน์โหลดเวอร์ชันนี้</a> · ` : ''}<a href="${esc(r.htmlUrl)}" target="_blank" rel="noopener">GitHub Release</a></p>
        </div>
      </article>`;
  }).join('');
}

// ------------------------------------------------------------------ states

export function renderEmpty(data, { compact = false } = {}) {
  if (data.error) {
    return `<div class="state state-error${compact ? ' compact' : ''}">${ICON.alert}
      <div><strong>โหลดข้อมูลเวอร์ชันไม่สำเร็จ</strong><p class="small">${esc(data.error)}</p>
      <button type="button" class="btn btn-secondary btn-sm" data-retry>ลองอีกครั้ง</button>
      <a class="btn btn-ghost btn-sm" href="https://github.com/${esc(data.repo)}/releases" target="_blank" rel="noopener">เปิด GitHub Releases</a></div></div>`;
  }
  return `<div class="state state-empty${compact ? ' compact' : ''}">${ICON.file}
    <div><strong>ยังไม่มีเวอร์ชันที่เผยแพร่</strong>
    <p class="small">เมื่อ RAMFLOW ADMIN เผยแพร่เวอร์ชันแรก ปุ่มดาวน์โหลดจะปรากฏที่นี่โดยอัตโนมัติ</p></div></div>`;
}

/** JSON-LD for search engines (SoftwareApplication). */
export function renderJsonLd(data, siteUrl) {
  const latest = findLatest(data);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'RAMFLOW',
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Windows 10, Windows 11 (64-bit)',
    description: 'RAMFLOW — โปรแกรมดูแลหน่วยความจำ (RAM) สำหรับ Windows ดู RAM แบบเรียลไทม์ ล้าง Standby List ด้วย Microsoft RAMMap และล้างอัตโนมัติพร้อมระบบป้องกัน',
    url: siteUrl,
    image: new URL('assets/img/logo.png', siteUrl).href,
  };
  if (latest) {
    const a = primaryAsset(latest);
    Object.assign(ld, { softwareVersion: latest.version, datePublished: isoDate(latest.publishedAt), downloadUrl: a.url, fileSize: formatBytes(a.size) });
  }
  return JSON.stringify(ld).replace(/</g, '\\u003c');
}

export { compareVersions };

/** Call-to-action buttons at the bottom of the home page. */
export function renderCta(data) {
  const latest = data.releases.find(r => r.version === data.latestVersion);
  if (!latest) return renderEmpty(data, { compact: true });
  const asset = primaryAsset(latest);
  return `<div class="hero-actions">
      <a class="btn btn-primary btn-lg" ${downloadAttrs(latest, asset)}>${ICON.download}<span>ดาวน์โหลด v${esc(latest.version)} · ${esc(formatBytes(asset.size))}</span></a>
      <a class="btn btn-ghost btn-lg" href="{{root}}versions/">ดูทุกเวอร์ชัน</a>
    </div>`;
}
