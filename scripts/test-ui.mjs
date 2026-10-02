import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { settingsHarness } from '../tests/settings-harness.ts';
import { SessionId } from '@deepseek-ai/dsh-session';
import { buildModelCatalog } from '@deepseek-ai/dsh-api-session-controller';
import { CatalogAdapter } from '../tests/catalog-adapter.ts';
import { nativeModelHost } from '../tests/native-model-host.ts';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

await mkdir('.test-output', { recursive: true });
const temp = await mkdtemp(join('.test-output', 'ui-'));
const regressionIndex = process.argv.indexOf('--regression-client');
const regressionClient = regressionIndex === -1 ? undefined : process.argv[regressionIndex + 1];
if (regressionIndex !== -1 && !regressionClient) throw new Error('Supply a client bundle after --regression-client.');
let browser, server, host, releasePreference;
try {
  const catalogAdapter = new CatalogAdapter();
  host = await settingsHarness(catalogAdapter);
  host.ctx.llm.registerAdapter(['external'], catalogAdapter);
  let native = await nativeModelHost(host.ctx, host.profile.cwd);
  const advertised = await buildModelCatalog(host.ctx, { provider: 'fixture', model: 'capable' });
  assert.deepEqual(advertised.failures, []);
  assert.equal(advertised.groups.flatMap(group => group.models).length, 6);
  let catalogOffline = false;
  let parent = await host.createParent(), refuseNext = false, refuseModel = false, preferenceWrites = 0;
  let holdPreference = false, preferenceHeld = false;
  native.attach(parent);
  const hostState = () => {
    const descriptor = host.ctx.settings.describe().find(item => item.ns === 'dsh-agent-router');
    return { sessionId: parent.id, state: { status: 'ready', value: descriptor.value, base: descriptor.base, user: descriptor.user,
      revision: descriptor.revision, writable: host.ctx.settings.writable, mode: 'host' } };
  };
  await build({ entryPoints: ['tests/ui-harness.tsx'], outfile: join(temp, 'app.js'), bundle: true, platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'text', '.module.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"production"' } });
  const nativeSource = await readFile('node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', 'utf8');
  const marker = 'exports.Config = Config;';
  assert.equal(nativeSource.split(marker).length, 2, 'Native composer fixture export marker changed.');
  await writeFile(join(temp, 'conversation.js'), nativeSource.replace(marker,
    'exports.__fixtureInputBar = InputBar; exports.__fixtureLocales = {zh, en}; exports.__fixtureCSS = InputBar_module_css_default;' + marker));
  await writeFile(join(temp, 'plugin.js'), await readFile(regressionClient ?? 'lib/client.js'));
  const modelSource = await readFile('node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js', 'utf8');
  const modelMarker = 'exports.ModelDirectory = ModelDirectory;';
  assert.equal(modelSource.split(modelMarker).length, 2);
  await writeFile(join(temp, 'models.js'), modelSource.replace(modelMarker, 'exports.__fixtureModelSelect = ModelSelect; exports.__fixtureLocales = {zh, en};' + modelMarker));
  const tokens = `
    :root {--dsw-alias-label-primary:#26313d;--dsw-alias-label-secondary:#657382;--dsw-alias-label-tertiary:#a1acb8;--dsw-alias-bg-layer-1:#fff;--dsw-alias-border-l3:#dce2e8;--dsw-alias-interactive-bg-hover:#f3f6f9;--dsw-static-blue-450:#4385d1;--dsw-static-green-500:#2b9460;--dsw-static-red-500:#df5454;--dsw-radius-md:8px;background:#fff;color:#26313d}
    :root[data-theme=dark]{--dsw-alias-label-primary:#e1e7ee;--dsw-alias-label-secondary:#a4afbd;--dsw-alias-label-tertiary:#697482;--dsw-alias-bg-layer-1:#222832;--dsw-alias-border-l3:#414c5a;--dsw-alias-interactive-bg-hover:#2b3441;background:#1c222b;color:#e1e7ee}
    body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px} header{padding:18px 22px 10px;font-size:14px;font-weight:500} main{padding:0 8px}
    .fixture-conversation{padding:300px 0 12px; --dsh-composer-card-max-width:960px; --dsh-composer-side-clearance:8px; --dsw-font-family:"Segoe UI","Microsoft YaHei",sans-serif; --dsw-radius-sm:6px; --dsw-radius-lg:12px; --dsw-radius-panel:24px; --dsw-specific-input-major:var(--dsw-alias-bg-layer-1); --dsw-specific-selector:var(--dsw-alias-interactive-bg-hover); --dsw-alias-border-l2:var(--dsw-alias-border-l3); --dsw-elevation-soft:0 0 0 .5px var(--dsw-alias-border-l2), 0 3px 20px #00000008}
    :root{--dsw-radius-lg:12px;--dsw-radius-sm:6px;--dsw-alias-border-l1:var(--dsw-alias-border-l3);--dsw-menu-surface-fill:var(--dsw-alias-bg-layer-1);--dsw-elevation-menu:0 8px 28px #00000020;--dsw-alias-button-info-fill:#3964fe;--dsw-alias-button-primary-fill:#26313d;--dsw-alias-label-primary-foreground:#fff;--dsw-alias-label-caption:#a1acb8;--dsw-font-family:"Segoe UI","Microsoft YaHei",sans-serif}
    :root[data-theme=dark]{--dsw-alias-button-info-fill:#679efe;--dsw-alias-button-primary-fill:#e1e7ee;--dsw-alias-label-primary-foreground:#1c222b}
    button,input,select{font-family:inherit}.fixture-native-chip{font-size:13px!important;line-height:20px!important;font-weight:500;color:var(--dsw-alias-label-secondary)!important;padding:0 4px!important;white-space:nowrap}.fixture-stats{display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;font:12px/20px "Segoe UI","Microsoft YaHei",sans-serif;color:var(--dsw-alias-label-secondary)}
  `;
  await writeFile(join(temp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>${tokens}</style></head><body><header>Agent 调用图</header><main id="root"></main><script src="/app.js"></script></body></html>`);
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (['/prefs', '/catalog', '/catalog-mode', '/chat', '/reject', '/restart', '/selection', '/select', '/reject-model', '/prompt', '/hold-prefs', '/prefs-held', '/release-prefs'].includes(path)) {
      response.setHeader('Content-Type', 'application/json');
      try {
        if (request.url === '/prefs' && request.method === 'POST') {
          preferenceWrites++;
          let raw = ''; for await (const chunk of request) raw += chunk;
          const { ops, expectedRevision } = JSON.parse(raw);
          if (holdPreference) {
            holdPreference = false; preferenceHeld = true;
            await new Promise(resolve => { releasePreference = resolve; }); preferenceHeld = false;
          }
          let accepted = !refuseNext; refuseNext = false;
          if (accepted) try { await host.ctx.settings.mutate('dsh-agent-router', ops, expectedRevision); } catch { accepted = false; }
          response.end(JSON.stringify({ accepted, ...hostState() })); return;
        }
        if (request.url === '/catalog') {
          if (catalogOffline) { response.statusCode = 503; response.end(JSON.stringify({ code: 'connection/offline', message: 'Fixture offline' })); return; }
          response.end(JSON.stringify(await buildModelCatalog(host.ctx, native.defaultSelection))); return;
        }
        if (path === '/selection') {
          const agent = host.ctx.agents.get(SessionId(new URL(request.url, 'http://localhost').searchParams.get('sessionId')));
          response.end(JSON.stringify({ projection: agent ? native.snapshot(agent) : { lastUsed: null, next: null } })); return;
        }
        if (path === '/select') {
          let raw = ''; for await (const chunk of request) raw += chunk;
          const selection = JSON.parse(raw);
          if (refuseModel) {
            refuseModel = false;
            response.end(JSON.stringify({ ok: false, error: { code: 'llm/unavailable', message: 'Fixture selection refused' } })); return;
          }
          try {
            const value = await native.select(selection);
            response.end(JSON.stringify({ ok: true, value, projection: native.snapshot(host.ctx.agents.get(SessionId(selection.sessionId))) }));
          } catch (error) {
            response.end(JSON.stringify({ ok: false, error: { code: error.code ?? 'gateway/internal', message: error.message } }));
          }
          return;
        }
        if (path === '/prompt') {
          const start = catalogAdapter.requests.length;
          parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Check the selected route.' }], source: { kind: 'user' } }));
          await parent.whenIdle();
          response.end(JSON.stringify({ projection: native.snapshot(parent), requests: catalogAdapter.requests.slice(start).map(({ provider, model, reasoningEffort }) => ({ provider, model, reasoningEffort })) })); return;
        }
        if (request.url === '/catalog-mode') {
          let mode = ''; for await (const chunk of request) mode += chunk;
          catalogOffline = mode === 'offline'; catalogAdapter.extra = mode === 'extra'; catalogAdapter.failExternal = mode === 'partial';
        }
        if (request.url === '/chat') { parent = await host.createParent(); native.attach(parent); }
        if (request.url === '/reject') refuseNext = true;
        if (request.url === '/reject-model') refuseModel = true;
        if (request.url === '/hold-prefs') holdPreference = true;
        if (request.url === '/prefs-held') { response.end(JSON.stringify({ held: preferenceHeld })); return; }
        if (request.url === '/release-prefs') { releasePreference?.(); releasePreference = undefined; }
        if (request.url === '/restart') {
          const id = parent.id, initial = native.defaultSelection;
          await host.restart(); host.ctx.llm.registerAdapter(['external'], catalogAdapter);
          native = await nativeModelHost(host.ctx, host.profile.cwd, initial);
          parent = await host.createParent(SessionId(id)); native.attach(parent);
        }
        response.end(JSON.stringify(hostState())); return;
      } catch { response.statusCode = 500; response.end(JSON.stringify({ error: 'Fixture Host failed' })); return; }
    }
    const file = ['/app.js', '/app.css', '/conversation.js', '/models.js', '/plugin.js'].includes(request.url) ? request.url.slice(1) : 'index.html';
    try { response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8'); response.end(await readFile(join(temp, file))); }
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
  const assertComposerLayout = async page => {
    const layout = await page.evaluate(() => {
      const css = window.fixtureNativeClasses;
      const card = document.querySelector('.' + css.card).getBoundingClientRect();
      const controls = document.querySelector('.dar-controls').getBoundingClientRect();
      const inside = controls.left >= card.left && controls.right <= card.right + 1 && controls.top >= card.top && controls.bottom <= card.bottom;
      if (!inside) return { inside };
      const stats = document.querySelector('.fixture-stats').getBoundingClientRect();
      const toggle = document.querySelector('.dar-toggle').getBoundingClientRect();
      const choose = document.querySelector('.dar-choose').getBoundingClientRect();
      const tools = document.querySelector('.' + css.tools);
      const permission = tools.querySelector('.fixture-native-chip').getBoundingClientRect();
      return { inside,
        separateStats: stats.top >= card.bottom, intrinsic: controls.width > 80, separateButtons: toggle.right <= choose.left + 1,
        separatePermission: permission.right <= controls.left + 1 || permission.bottom <= controls.top,
        fits: document.documentElement.scrollWidth <= innerWidth,
        font: getComputedStyle(document.querySelector('.dar-toggle')).fontFamily };
    });
    assert.equal(layout.inside, true, 'Plugin must be inside the native composer card.');
    assert.equal(layout.separateStats, true, 'Statistics must remain below the composer.');
    assert.equal(layout.intrinsic, true, 'Toolbar control must retain its intrinsic width.');
    assert.equal(layout.separateButtons, true, 'Toggle and chooser must not overlap.');
    assert.equal(layout.separatePermission, true, 'Plugin must not overlap the permission selector.');
    assert.equal(layout.fits, true, 'Native composer must fit the window.');
    assert.match(layout.font, /Segoe UI/);
  };
  const assertPopoverFits = async page => {
    assert.equal(await page.locator('body > .dar-model-popover').count(), 1, 'Popover must escape composer overflow.');
    assert.equal(await page.locator('.dar-model-popover').evaluate(panel => {
      const box = panel.getBoundingClientRect();
      return box.left >= 11 && box.top >= 11 && box.right <= innerWidth - 11 && box.bottom <= innerHeight - 11;
    }), true, 'Popover must stay inside the viewport margins.');
  };
  for (const [width, theme] of [[916, 'light'], [320, 'dark']]) {
    await host.ctx.settings.update('dsh-agent-router', { chatBindings: [], lastMainModelId: '', lastWorkerModelId: '' });
    parent = await host.createParent(); native.attach(parent);
    await native.select({ sessionId: parent.id, provider: 'fixture', model: 'capable' });
    const page = await browser.newPage({ viewport: { width, height: 650 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Desktop fixture:', error.message); });
    await page.goto(url + '?view=controls');
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const toggle = page.getByRole('switch', { name: '模型分工' });
    await toggle.waitFor(); assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    if (regressionClient) {
      await page.locator('.fixture-conversation > div').screenshot({ path: '.test-output/old-composer-regression.png' });
      await assert.rejects(assertComposerLayout(page), /Plugin must be inside the native composer card/);
      assert.equal(await page.locator('.dar-controls').evaluate(element => element.getBoundingClientRect().width < 16), true,
        'Old containment must reproduce the collapsed footer width.');
      assert.deepEqual(errors, []);
      console.log('Negative control: old client reproduces the collapsed footer control and fails the native composer geometry check.');
      await page.close(); break;
    }
    assert.equal(await page.evaluate(() => window.fixtureSlots.includes('conversation.input.left') && !window.fixtureSlots.includes('conversation.composer.dock')), true);
    await assertComposerLayout(page);
    assert.equal(await page.getByRole('combobox').count(), 0);
    await page.locator('.fixture-conversation > div').screenshot({ path: `docs/composer-off-${theme}.png` });
    const nativeTrigger = page.locator('.fixture-model button[aria-haspopup="menu"]');
    await nativeTrigger.click();
    await page.getByRole('menuitem').filter({ hasText: '模型' }).first().click();
    const nativeModels = page.getByRole('menu', { name: '模型', exact: true });
    await nativeModels.getByRole('menuitemradio', { name: 'External Flash', exact: true }).waitFor();
    const nativeNames = (await nativeModels.getByRole('menuitemradio').allTextContents()).map(text => text.trim());
    assert.equal(nativeNames.length, 6);
    assert.equal(await nativeModels.getByText('Fixture provider', { exact: true }).count(), 1);
    assert.equal(await nativeModels.getByText('External API', { exact: true }).count(), 1);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    assert.equal(await nativeTrigger.getAttribute('aria-expanded'), 'false');
    const calls = await page.evaluate(() => window.fixtureCatalogCalls());
    await toggle.click();
    const main = page.getByRole('button', { name: '主模型', exact: true }), worker = page.getByRole('button', { name: '子模型', exact: true });
    const choose = async (label, name) => {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('menuitemradio', { name, exact: true }).click();
      await page.waitForFunction(({ label, name }) => !document.querySelector('.dar-controls')?.getAttribute('aria-busy')?.includes('true') &&
        document.querySelector(`[aria-label="${label}"]`)?.textContent.includes(name), { label, name });
    };
    const nativeChoose = async name => {
      await nativeTrigger.click();
      await page.getByRole('menuitem').filter({ hasText: '模型' }).first().click();
      await page.getByRole('menu', { name: '模型', exact: true }).getByRole('menuitemradio', { name, exact: true }).click();
      await page.waitForFunction(name => document.querySelector('.fixture-model button[aria-haspopup="menu"]')?.textContent.includes(name), name);
    };
    const requestRoute = async (provider, model) => {
      const requests = await page.evaluate(id => window.fixturePrompt(id), parent.id);
      assert.deepEqual(requests, [{ provider, model }], 'The real DSH loop must dispatch to the model displayed by both entries.');
    };
    const waitRemembered = async (provider, model) => {
      await page.waitForFunction(async ({ provider, model }) => {
        const { state } = await (await fetch('/prefs')).json();
        const saved = state.value.models.find(item => item.id === state.value.lastMainModelId);
        return saved?.provider === provider && saved?.model === model && !document.querySelector('[role=switch]')?.disabled;
      }, { provider, model });
    };
    await worker.click();
    const workerMenu = page.getByRole('menu', { name: '子模型', exact: true });
    assert.deepEqual((await workerMenu.getByRole('menuitemradio').allTextContents()).map(text => text.trim()), nativeNames,
      'Plugin and original right-side picker must show the same native catalog.');
    assert.equal(await workerMenu.getByText('Fixture provider', { exact: true }).count(), 1);
    assert.equal(await workerMenu.getByText('External API', { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.fixtureCatalogCalls()), calls, 'The plugin must reuse the native catalog cache.');
    await assertPopoverFits(page);
    await page.locator('.dar-model-popover').screenshot({ path: `docs/model-list-${theme}.png` });
    const search = page.getByRole('searchbox', { name: '搜索模型', exact: true });
    await search.fill('flash');
    assert.equal(await workerMenu.getByRole('menuitemradio').count(), 1);
    await page.keyboard.press('Enter');
    assert.match(await worker.innerText(), /External Flash/);
    await choose('主模型', 'External Capable');
    assert.match(await main.innerText(), /External Capable/);
    await choose('主模型', 'Capable Model');
    await page.evaluate(() => window.fixtureRejectNext());
    await page.getByRole('button', { name: '启用', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    assert.equal(hostState().state.value.chatBindings.length, 0);
    await page.getByRole('button', { name: '启用', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'true');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await assertComposerLayout(page);
    const chooser = page.getByRole('button', { name: '选择模型', exact: true });
    await page.locator('.fixture-conversation > div').screenshot({ path: `docs/composer-${theme}.png` });
    await chooser.click(); await assertPopoverFits(page);
    assert.match(await main.innerText(), /Capable Model/);
    const externalBinding = hostState().state.value.chatBindings.find(item => item.sessionId === parent.id);
    const externalWorker = hostState().state.value.models.find(item => item.id === externalBinding.workerModelId);
    assert.equal(externalWorker.provider, 'external'); assert.equal(externalWorker.model, 'flash');
    assert.equal(externalWorker.inputPrice, -1, 'New catalog routes must not invent a price.');
    await choose('子模型', 'Economy Model');
    await page.waitForFunction(() => !document.querySelector('[role=switch]')?.disabled && document.querySelector('[aria-label="子模型"]')?.textContent.includes('Economy Model'));
    assert.equal(hostState().state.value.chatBindings.find(item => item.sessionId === parent.id)?.workerModelId, 'economy');
    const panelBox = await page.locator('.dar-model-popover').boundingBox(), composerBox = await page.locator('.fixture-conversation > div').boundingBox();
    const top = Math.min(panelBox.y, composerBox.y) - 8;
    await page.screenshot({ path: `docs/model-picker-${theme}.png`, clip: { x: 0, y: top, width, height: composerBox.y + composerBox.height - top + 8 } });
    await page.evaluate(() => window.fixtureRejectNext());
    await choose('主模型', 'Review Model');
    await page.getByRole('alert').waitFor();
    assert.match(await main.innerText(), /Review Model/);
    assert.match(await nativeTrigger.getAttribute('aria-label'), /Review Model/);
    assert.match(await page.getByRole('alert').innerText(), /分工偏好未保存/);
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    assert.equal(hostState().state.value.lastMainModelId, 'capable', 'A refused preference save must leave the saved form untouched.');
    const writesAfterFailure = preferenceWrites;
    await requestRoute('fixture', 'judge');
    await worker.click(); await page.keyboard.press('Escape');
    assert.equal(preferenceWrites, writesAfterFailure, 'An unsuccessful automatic save must not spin in a write loop.');
    await page.getByRole('alert').getByRole('button', { name: '重试', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[role=switch]')?.disabled && document.querySelector('[aria-label="主模型"]')?.textContent.includes('Review Model') && !document.querySelector('[role=alert]'));
    assert.equal(hostState().state.value.lastMainModelId, 'judge');
    await page.evaluate(() => fetch('/reject-model', { method: 'POST' }));
    await main.click(); await page.getByRole('menuitemradio', { name: 'Capable Model', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /主模型切换失败/);
    assert.match(await main.innerText(), /Review Model/); assert.match(await nativeTrigger.getAttribute('aria-label'), /Review Model/);
    assert.equal(await page.getByRole('alert').getByRole('button').count(), 0);
    assert.equal(hostState().state.value.lastMainModelId, 'judge');
    await choose('主模型', 'Capable Model');
    assert.match(await nativeTrigger.getAttribute('aria-label'), /Capable Model/);
    await requestRoute('fixture', 'capable');
    await page.evaluate(() => window.fixtureRejectNext());
    await worker.click(); await page.getByRole('menuitemradio', { name: 'External Flash', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await worker.innerText(), /Economy Model/);
    await page.getByRole('alert').getByRole('button', { name: '重试', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[role=switch]')?.disabled &&
      document.querySelector('[aria-label="子模型"]')?.textContent.includes('External Flash') && !document.querySelector('[role=alert]'));
    assert.match(await nativeTrigger.getAttribute('aria-label'), /Capable Model/);
    await choose('子模型', 'Economy Model');
    await nativeChoose('External Capable'); await waitRemembered('external', 'capable');
    await chooser.click();
    assert.match(await main.innerText(), /External Capable/); assert.match(await worker.innerText(), /Economy Model/);
    await requestRoute('external', 'capable');
    await nativeChoose('Review Model'); await waitRemembered('fixture', 'judge');
    await chooser.click();
    assert.match(await main.innerText(), /Review Model/);
    await requestRoute('fixture', 'judge');
    await page.evaluate(() => fetch('/hold-prefs', { method: 'POST' }));
    await main.click(); await page.getByRole('menuitemradio', { name: 'Capable Model', exact: true }).click();
    await page.waitForFunction(async () => (await (await fetch('/prefs-held')).json()).held);
    await nativeChoose('External Review');
    await page.evaluate(() => fetch('/release-prefs', { method: 'POST' }));
    await waitRemembered('external', 'review');
    await chooser.click();
    assert.match(await main.innerText(), /External Review/); assert.match(await worker.innerText(), /Economy Model/);
    await requestRoute('external', 'review');
    await nativeChoose('Review Model'); await waitRemembered('fixture', 'judge');
    await chooser.click();
    await worker.click();
    await page.evaluate(() => window.fixtureCatalogMode('extra'));
    await workerMenu.getByRole('menuitemradio', { name: 'Newly Added Model', exact: true }).waitFor();
    await search.fill('no-such-model');
    await page.getByRole('status').filter({ hasText: '没有匹配的模型' }).waitFor();
    assert.equal(await workerMenu.getByRole('menuitemradio').count(), 0);
    await search.fill('');
    await page.evaluate(() => window.fixtureCatalogMode('partial'));
    await page.getByRole('status').filter({ hasText: '部分供应商未能读取' }).waitFor();
    assert.equal(await workerMenu.getByRole('menuitemradio', { name: 'Economy Model', exact: true }).count(), 1);
    await page.evaluate(() => window.fixtureCatalogMode('offline'));
    await page.getByRole('status').filter({ hasText: '模型目录未能读取' }).waitFor();
    assert.equal(await workerMenu.getByRole('menuitemradio', { name: 'Economy Model', exact: true }).count(), 1,
      'A connection failure must retain the last good catalog.');
    await page.evaluate(() => fetch('/catalog-mode', { method: 'POST', body: 'normal' }));
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await workerMenu.getByRole('menuitemradio', { name: 'External Capable', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: '模型目录未能读取' }).waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 1, 'Escape in the model list returns to the pair.');
    assert.match(await main.innerText(), /Review Model/); assert.match(await worker.innerText(), /Economy Model/);
    await page.evaluate(() => window.fixtureNewChat());
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'false');
    assert.equal(await page.getByRole('combobox').count(), 0);
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'true');
    await chooser.click();
    assert.match(await main.innerText(), /Review Model/);
    assert.match(await worker.innerText(), /Economy Model/);
    assert.match(await nativeTrigger.getAttribute('aria-label'), /Review Model/);
    await requestRoute('fixture', 'judge');
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'false');
    await page.evaluate(() => window.fixtureRestart());
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'true');
    await chooser.click();
    assert.match(await main.innerText(), /Review Model/);
    assert.match(await worker.innerText(), /Economy Model/);
    await requestRoute('fixture', 'judge');
    await assertPopoverFits(page);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await chooser.evaluate(button => button === document.activeElement), true);
    await chooser.click();
    await page.getByRole('button', { name: '工作区内修改' }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    for (const responsiveWidth of [916, 520, 320]) {
      await page.setViewportSize({ width: responsiveWidth, height: 650 });
      await assertComposerLayout(page);
      await chooser.click(); await assertPopoverFits(page);
      await worker.click(); await assertPopoverFits(page);
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    }
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'false');
    await nativeChoose('Economy Model');
    assert.equal(hostState().state.value.lastMainModelId, 'judge', 'Native selection while off must preserve the remembered delegation pair.');
    await requestRoute('fixture', 'economy');
    await page.evaluate(() => window.fixtureShowSettings());
    await page.getByText('价格与输出限制', { exact: true }).first().click();
    const inputPrice = theme === 'light' ? 3.5 : 4.5;
    await page.getByLabel('输入价格', { exact: true }).first().fill(String(inputPrice));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
    assert.equal(hostState().state.value.models[0].inputPrice, inputPrice);
    assert.deepEqual(errors, []); await page.evaluate(() => window.fixtureDisposeClient()); await page.close();
  }
  if (!regressionClient) console.log('UI: native DSH composer/picker, real selection commands and requests; bidirectional main sync, provider identity, actual routing after refused preference saves, selection failure/retry, shared catalog/cache, default-off, remembered pairs/restart, and 916/520/320px light/dark layouts passed.');
} finally {
  releasePreference?.();
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await host?.dispose();
  if (!resolve(temp).startsWith(resolve('.test-output') + sep)) throw new Error('Fixture cleanup escaped its private output root.');
  await rm(temp, { recursive: true, force: true });
}
