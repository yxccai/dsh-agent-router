import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadOverlayPatches, composeEntries } from '@deepseek-ai/dsh-app-boot';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FixtureAdapter, harness, settings, textResponse, toolResponse } from './harness.ts';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

test('DSH parses the installable bundle patch and activates a single plugin row', () => {
  const patches = loadOverlayPatches('dsh', resolve('cordis.patch.yml'));
  const rows = composeEntries([patches]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'dsh-agent-router');
  assert.equal(rows[0].name, 'dsh-agent-router');
  assert.equal(rows[0].disabled, undefined);
  assert.equal(rows[0].config.subagentProvider, 'spawn');
});

test('built client registers a lazy factory with the desktop ModuleLoader', async () => {
  const source = await readFile('lib/client.js', 'utf8');
  let registration: { id: string; factory: (require: (id: string) => object) => { apply: unknown; inject: string[] } } | undefined;
  runInNewContext(source, { window: { __ModuleLoader__: { load: (value: typeof registration) => { registration = value; } } } });
  assert.equal(registration?.id, 'dsh-agent-router');
  const ids: string[] = [];
  const client = registration!.factory(id => { ids.push(id); return {}; });
  assert.equal(typeof client.apply, 'function');
  assert.deepEqual(Array.from(client.inject), ['sessions', 'slots', 'locale', 'sidebarRightTabs', 'configForms', 'remote.session']);
  assert.deepEqual(new Set(ids), new Set(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']));
});

test('the built Host export delegates through a real DSH loop', async () => {
  const built = await import(pathToFileURL(resolve('lib/index.js')).href);
  const adapter = new FixtureAdapter((options, index) => index === 0
    ? toolResponse('team_delegate', { role: 'research', task: 'Extract.', acceptance: 'Use source.', context: 'source' })
    : textResponse(options.model === 'economy' ? 'extracted' : 'accepted'));
  const { ctx, parent } = await harness(adapter, settings(), built);
  try {
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Delegate.' }], source: { kind: 'user' } }));
    await parent.whenIdle();
    assert.deepEqual(adapter.requests.map(item => item.model), ['capable', 'economy', 'capable']);
    assert.equal(ctx.sessionProjections.snapshot(parent.session).values.subagentCatalog?.length, 1);
  } finally { await ctx.fiber.dispose(); }
});
