import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { settingsHarness } from '../tests/settings-harness.ts';
import { FixtureAdapter, textResponse } from '../tests/harness.ts';
import { SessionId } from '@deepseek-ai/dsh-session';

await mkdir('.test-output', { recursive: true });
const temp = await mkdtemp(join('.test-output', 'ui-'));
let browser, server, host;
try {
  host = await settingsHarness(new FixtureAdapter(() => textResponse('fixture')));
  let parent = await host.createParent(), refuseNext = false;
  const hostState = () => {
    const descriptor = host.ctx.settings.describe().find(item => item.ns === 'dsh-agent-router');
    return { sessionId: parent.id, state: { status: 'ready', value: descriptor.value, base: descriptor.base, user: descriptor.user,
      revision: descriptor.revision, writable: host.ctx.settings.writable, mode: 'host' } };
  };
  await build({ entryPoints: ['tests/ui-harness.tsx'], outfile: join(temp, 'app.js'), bundle: true, platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' } });
  const tokens = `
    :root {--dsw-alias-label-primary:#26313d;--dsw-alias-label-secondary:#657382;--dsw-alias-label-tertiary:#a1acb8;--dsw-alias-bg-layer-1:#fff;--dsw-alias-border-l3:#dce2e8;--dsw-alias-interactive-bg-hover:#f3f6f9;--dsw-static-blue-450:#4385d1;--dsw-static-green-500:#2b9460;--dsw-static-red-500:#df5454;--dsw-radius-md:8px;background:#fff;color:#26313d}
    :root[data-theme=dark]{--dsw-alias-label-primary:#e1e7ee;--dsw-alias-label-secondary:#a4afbd;--dsw-alias-label-tertiary:#697482;--dsw-alias-bg-layer-1:#222832;--dsw-alias-border-l3:#414c5a;--dsw-alias-interactive-bg-hover:#2b3441;background:#1c222b;color:#e1e7ee}
    body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px} header{padding:18px 22px 10px;font-size:14px;font-weight:500} main{padding:0 8px}
    .fixture-conversation{padding:14px 10px}.fixture-composer{border:1px solid var(--dsw-alias-border-l3);border-radius:12px;padding:12px;background:var(--dsw-alias-bg-layer-1)}.fixture-composer textarea{resize:none;width:100%;height:68px;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;line-height:1.7}.fixture-submit{display:flex;align-items:center;justify-content:flex-end;gap:12px;font-size:12px;color:var(--dsw-alias-label-secondary)}.fixture-submit span:last-child{display:grid;place-items:center;width:26px;height:26px;border:1px solid var(--dsw-alias-border-l3);border-radius:50%;font-size:18px}
  `;
  await writeFile(join(temp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><style>${tokens}</style></head><body><header>Agent 调用图</header><main id="root"></main><script src="/app.js"></script></body></html>`);
  server = createServer(async (request, response) => {
    if (['/prefs', '/catalog', '/chat', '/reject', '/restart'].includes(request.url)) {
      response.setHeader('Content-Type', 'application/json');
      try {
        if (request.url === '/prefs' && request.method === 'POST') {
          let raw = ''; for await (const chunk of request) raw += chunk;
          const { ops, expectedRevision } = JSON.parse(raw);
          let accepted = !refuseNext; refuseNext = false;
          if (accepted) try { await host.ctx.settings.mutate('dsh-agent-router', ops, expectedRevision); } catch { accepted = false; }
          response.end(JSON.stringify({ accepted, ...hostState() })); return;
        }
        if (request.url === '/catalog') {
          response.end(JSON.stringify({ default: { provider: 'fixture', model: 'capable' }, routableProviders: ['fixture'], failures: [],
            groups: [{ id: 'fixture', name: 'Fixture provider', models: [{ id: 'capable', name: 'Capable Model' }, { id: 'economy', name: 'Economy Model' }, { id: 'judge', name: 'Review Model' }] }] })); return;
        }
        if (request.url === '/chat') parent = await host.createParent();
        if (request.url === '/reject') refuseNext = true;
        if (request.url === '/restart') { const id = parent.id; await host.restart(); parent = await host.createParent(SessionId(id)); }
        response.end(JSON.stringify(hostState())); return;
      } catch { response.statusCode = 500; response.end(JSON.stringify({ error: 'Fixture Host failed' })); return; }
    }
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
  for (const [width, theme] of [[720, 'light'], [320, 'dark']]) {
    await host.ctx.settings.update('dsh-agent-router', { chatBindings: [], lastMainModelId: '', lastWorkerModelId: '' });
    parent = await host.createParent();
    const page = await browser.newPage({ viewport: { width, height: 480 }, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url + '?view=controls');
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const toggle = page.getByRole('switch', { name: '模型分工' });
    await toggle.waitFor(); assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    assert.equal(await page.getByRole('combobox').count(), 0);
    await toggle.click();
    const main = page.getByRole('combobox', { name: '主模型' }), worker = page.getByRole('combobox', { name: '子模型' });
    await worker.selectOption(JSON.stringify(['fixture', 'economy']));
    await page.evaluate(() => window.fixtureRejectNext());
    await page.getByRole('button', { name: '启用', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    assert.equal(hostState().state.value.chatBindings.length, 0);
    await page.getByRole('button', { name: '启用', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'true');
    assert.equal(await main.inputValue(), JSON.stringify(['fixture', 'capable']));
    assert.equal(hostState().state.value.chatBindings.find(item => item.sessionId === parent.id)?.workerModelId, 'economy');
    await page.locator('.fixture-conversation').screenshot({ path: `docs/composer-${theme}.png` });
    await page.evaluate(() => window.fixtureRejectNext());
    await main.selectOption(JSON.stringify(['fixture', 'judge']));
    await page.getByRole('alert').waitFor();
    assert.equal(await main.inputValue(), JSON.stringify(['fixture', 'capable']));
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await main.selectOption(JSON.stringify(['fixture', 'judge']));
    await page.waitForFunction(value => !document.querySelector('[role=switch]')?.disabled && document.querySelector('[aria-label="主模型"]')?.value === value && !document.querySelector('[role=alert]'), JSON.stringify(['fixture', 'judge']));
    assert.equal(hostState().state.value.lastMainModelId, 'judge');
    await page.evaluate(() => window.fixtureNewChat());
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'false');
    assert.equal(await page.getByRole('combobox').count(), 0);
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'true');
    assert.equal(await main.inputValue(), JSON.stringify(['fixture', 'judge']));
    assert.equal(await worker.inputValue(), JSON.stringify(['fixture', 'economy']));
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'false');
    await page.evaluate(() => window.fixtureRestart());
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'true');
    assert.equal(await main.inputValue(), JSON.stringify(['fixture', 'judge']));
    assert.equal(await worker.inputValue(), JSON.stringify(['fixture', 'economy']));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => window.fixtureShowSettings());
    await page.getByText('价格与输出限制', { exact: true }).first().click();
    const inputPrice = theme === 'light' ? 3.5 : 4.5;
    await page.getByLabel('输入价格', { exact: true }).first().fill(String(inputPrice));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
    assert.equal(hostState().state.value.models[0].inputPrice, inputPrice);
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('UI: graph themes, edges/details/focus; chat default-off, model selection, Host acceptance/refusal, new chats, remembered pairs after restart, narrow layout and native settings saves passed.');
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await host?.dispose();
  if (!resolve(temp).startsWith(resolve('.test-output') + sep)) throw new Error('Fixture cleanup escaped its private output root.');
  await rm(temp, { recursive: true, force: true });
}
