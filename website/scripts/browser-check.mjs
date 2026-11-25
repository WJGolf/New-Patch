// Real-browser check of the built site (Chrome/Edge via the DevTools protocol, no dependencies).
// For every page and viewport: no JS errors, no horizontal overflow, live GitHub check result, screenshots.
//
//   node scripts/serve.mjs            (in another terminal)
//   node scripts/browser-check.mjs [baseUrl] [outDir]
//
// Env: BROWSER — path to chrome.exe / msedge.exe (auto-detected on Windows).

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const base = (process.argv[2] || 'http://localhost:4173/').replace(/\/?$/, '/');
const outDir = process.argv[3] || path.join(tmpdir(), 'ramflow-website-check');
const BROWSERS = [
  process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);
const browser = BROWSERS.find(p => existsSync(p));
if (!browser) { console.error('No Chrome/Edge found; set BROWSER'); process.exit(2); }

const PAGES = ['', 'download/', 'versions/', 'changelog/', 'faq/', 'does-not-exist/'];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false, scale: 1 },
  { name: 'tablet', width: 820, height: 1180, mobile: true, scale: 2 },
  { name: 'mobile', width: 390, height: 844, mobile: true, scale: 2 },
];

const profile = await mkdtemp(path.join(tmpdir(), 'ramflow-cdp-'));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(browser, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

async function waitForBrowser() {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  throw new Error('browser did not start');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new Cdp(ws);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) { const { res, rej } = c.pending.get(msg.id); c.pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
      else c.listeners.forEach(l => l(msg));
    };
    return c;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
}

const failures = [];
try {
  const { webSocketDebuggerUrl } = await waitForBrowser();
  const cdp = await Cdp.connect(webSocketDebuggerUrl);
  await mkdir(outDir, { recursive: true });

  for (const vp of VIEWPORTS) {
    for (const page of PAGES) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const errors = [];
      const onMsg = m => {
        if (m.sessionId !== sessionId) return;
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
        if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url || '')
            && !(page === 'does-not-exist/' && /404/.test(m.params.entry.text))) errors.push(m.params.entry.text);
      };
      cdp.listeners.push(onMsg);
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Log.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.scale, mobile: vp.mobile }, sessionId);
      await cdp.send('Page.navigate', { url: base + page }, sessionId);
      await new Promise(r => setTimeout(r, 3500)); // load + live GitHub check
      const { result } = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'));
        const wide = [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed')
          .slice(0, 5).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.'));
        return { title: document.title, scrollWidth: document.documentElement.scrollWidth, innerWidth,
          status: document.querySelector('[data-live-status]')?.dataset.state,
          downloads: [...document.querySelectorAll('a[data-download]')].map(a => a.href),
          canonical: document.querySelector('link[rel=canonical]')?.href, wide };
      })()` }, sessionId);
      const info = result.value;
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId).catch(() => ({ data: null }));
      const name = `${vp.name}-${(page || 'home').replace(/\/$/, '').replace(/\//g, '_')}.png`;
      if (data) await writeFile(path.join(outDir, name), Buffer.from(data, 'base64'));
      const overflow = info.scrollWidth > info.innerWidth;
      const badDownloads = info.downloads.filter(h => !/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/v\d+\.\d+\.\d+\/[^/]+$/.test(h));
      const ok = !overflow && !errors.length && !badDownloads.length;
      if (!ok) failures.push({ vp: vp.name, page, overflow, wide: info.wide, errors, badDownloads });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${vp.name.padEnd(7)} /${page.padEnd(16)} live=${info.status} downloads=${info.downloads.length} width=${info.scrollWidth}/${info.innerWidth}`
        + (overflow ? ` overflow:${info.wide.join(',')}` : '') + (errors.length ? ` errors:${errors.join(' | ')}` : ''));
      cdp.listeners = cdp.listeners.filter(l => l !== onMsg);
      await cdp.send('Target.closeTarget', { targetId });
    }
  }
  cdp.ws.close();
} finally {
  proc.kill();
  await new Promise(r => setTimeout(r, 500));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(`Screenshots: ${outDir}`);
console.log(failures.length ? `${failures.length} check(s) failed` : 'All browser checks passed');
process.exit(failures.length ? 1 : 0);
