import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

await mkdir('.test-output', { recursive: true });
const temp = await mkdtemp(join('.test-output', 'ui-'));
let browser, server;
try {
  await build({ entryPoints: ['tests/ui-harness.tsx'], outfile: join(temp, 'app.js'), bundle: true, platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' } });
  const tokens = `
    :root {--dsw-alias-label-primary:#26313d;--dsw-alias-label-secondary:#657382;--dsw-alias-label-tertiary:#a1acb8;--dsw-alias-bg-layer-1:#fff;--dsw-alias-border-l3:#dce2e8;--dsw-alias-interactive-bg-hover:#f3f6f9;--dsw-static-blue-450:#4385d1;--dsw-static-green-500:#2b9460;--dsw-static-red-500:#df5454;--dsw-radius-md:8px;background:#fff;color:#26313d}
    :root[data-theme=dark]{--dsw-alias-label-primary:#e1e7ee;--dsw-alias-label-secondary:#a4afbd;--dsw-alias-label-tertiary:#697482;--dsw-alias-bg-layer-1:#222832;--dsw-alias-border-l3:#414c5a;--dsw-alias-interactive-bg-hover:#2b3441;background:#1c222b;color:#e1e7ee}
    body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px} header{padding:18px 22px 10px;font-size:14px;font-weight:500} main{padding:0 8px}
  `;
  await writeFile(join(temp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><style>${tokens}</style></head><body><header>Agent 调用图</header><main id="root"></main><script src="/app.js"></script></body></html>`);
  server = createServer(async (request, response) => {
    const file = request.url.startsWith('/app.js') ? 'app.js' : 'index.html';
    try { response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8'); response.end(await readFile(join(temp, file))); }
    catch { response.statusCode = 500; response.end('Fixture could not load'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (!executablePath && process.platform === 'win32') {
    const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    try { await access(chrome); executablePath = chrome; } catch { /* Use Playwright's installed Chromium. */ }
  }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  await mkdir('docs', { recursive: true });
  for (const [width, theme] of [[520, 'light'], [320, 'dark']]) {
    const page = await browser.newPage({ viewport: { width, height: 520 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const nodes = page.locator('.dar-node');
    await nodes.first().waitFor();
    assert.equal(await nodes.count(), 4);
    assert.equal(await page.locator('.dar-edge').count(), 3);
    assert.equal(await page.locator('.dar-inspector').count(), 0);
    await page.screenshot({ path: `docs/screenshot-${theme}.png` });
    await page.locator('[data-agent-id=sources]').click();
    await page.getByRole('button', { name: '模型请求 · 1' }).click();
    assert.match(await page.locator('.dar-request').innerText(), /未知/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.dar-inspector').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.agentId), 'sources');
    await page.evaluate(() => window.failFixture());
    await page.getByRole('status').waitFor();
    assert.equal(await nodes.count(), 4);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('status').waitFor({ state: 'detached' });
    await page.evaluate(() => window.updateFixture());
    await page.waitForFunction(() => [...document.querySelectorAll('.dar-node')].every(node => node.dataset.state === 'completed'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('UI: light 520px, dark 320px, real component edges, click, request details, focus, refresh and failure preservation passed.');
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (!resolve(temp).startsWith(resolve('.test-output') + sep)) throw new Error('Fixture cleanup escaped its private output root.');
  await rm(temp, { recursive: true, force: true });
}
