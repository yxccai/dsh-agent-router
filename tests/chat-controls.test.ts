import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { configSchema, scopedSettings } from '../src/settings-schema.ts';
import { modelChoices, rememberPair, routeKey } from '../src/client/preferences.ts';
import { FixtureAdapter, settings, textResponse, toolResponse } from './harness.ts';
import { settingsHarness } from './settings-harness.ts';

function prompt(agent: Agent, text = 'Run.') {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
  return agent.whenIdle();
}

test('default-off chats cannot delegate or acquire a budget guard', async () => {
  const adapter = new FixtureAdapter((_, index) => index === 0 ? toolResponse('team_delegate', { role: 'research', task: 'Extract.', acceptance: 'Match source.' }) : textResponse('done'));
  const host = await settingsHarness(adapter);
  try {
    const parent = await host.createParent();
    await host.ctx.settings.update('dsh-agent-router', { sessionBudget: 0.000001 });
    assert.ok(!host.ctx.tools.schemas(parent).some(tool => tool.name === 'team_delegate' || tool.name === 'team_roles'));
    await prompt(parent);
    assert.deepEqual(adapter.requests.map(item => item.model), ['capable', 'capable']);
    assert.equal(host.ctx.sessionProjections.snapshot(parent.session).values.subagentCatalog?.length ?? 0, 0);
    assert.match(JSON.stringify(parent.session.snapshotEvents().filter(event => event.type === 'tool/result')), /not found|unknown tool/i);
    assert.equal(scopedSettings(configSchema.parse(host.ctx.settings.describe().find(item => item.ns === 'dsh-agent-router')!.value), parent.id), null);
  } finally { await host.dispose(); }
});

test('native saved pairs route real root/child requests, survive restart, and stay off for new chats', async () => {
  const adapter = new FixtureAdapter((options, index) => index === 0 ? toolResponse('team_delegate', { role: 'research', task: 'Extract.', acceptance: 'Use source.' }) : textResponse(options.model));
  const host = await settingsHarness(adapter);
  try {
    const parent = await host.createParent();
    const before = host.ctx.settings.describe().find(item => item.ns === 'dsh-agent-router')!;
    const original = configSchema.parse(before.value);
    const choices = modelChoices(original.models);
    const next = rememberPair(original, parent.id, choices.find(item => item.model === 'judge')!, choices.find(item => item.model === 'economy')!);
    const fields = ['models', 'lastMainModelId', 'lastWorkerModelId', 'chatBindings'] as const;
    await host.ctx.settings.mutate('dsh-agent-router', fields.map(field => ({ op: 'set', path: [field], value: next[field] })), before.revision);
    assert.ok(host.ctx.tools.schemas(parent).some(tool => tool.name === 'team_delegate'));
    await prompt(parent);
    assert.deepEqual(adapter.requests.map(item => item.model), ['judge', 'economy', 'judge']);
    const header = parent.session.snapshotEvents().find(event => event.type === 'request/header');
    assert.equal(header?.type === 'request/header' && header.data.header.config.model, 'judge');
    assert.equal(host.ctx.sessionProjections.snapshot(parent.session).values.agentRouter?.model, 'judge');
    await assert.rejects(host.ctx.settings.update('dsh-agent-router', { chatBindings: [] }, before.revision), /changed/);
    assert.match(await readFile(host.profile.patchPath, 'utf8'), /lastMainModelId/);
    await host.restart();
    const restored = configSchema.parse(host.ctx.settings.describe().find(item => item.ns === 'dsh-agent-router')!.value);
    assert.equal(restored.lastMainModelId, 'judge'); assert.equal(restored.lastWorkerModelId, 'economy');
    assert.equal(restored.chatBindings[0].sessionId, parent.id);
    const newParent = await host.createParent();
    assert.equal(scopedSettings(restored, newParent.id), null);
    await prompt(newParent);
    assert.equal(adapter.requests.at(-1)?.model, 'capable');
    await host.ctx.settings.update('dsh-agent-router', { chatBindings: [] });
    const disabled = configSchema.parse(host.ctx.settings.describe().find(item => item.ns === 'dsh-agent-router')!.value);
    assert.equal(disabled.lastMainModelId, 'judge'); assert.equal(disabled.lastWorkerModelId, 'economy');
    const pair = rememberPair(disabled, newParent.id, choices.find(item => item.model === 'judge')!, choices.find(item => item.model === 'economy')!);
    await host.ctx.settings.update('dsh-agent-router', pair);
    await prompt(newParent);
    assert.equal(adapter.requests.at(-1)?.model, 'judge');
    await host.ctx.settings.update('dsh-agent-router', { chatBindings: [] });
    await prompt(newParent);
    assert.equal(adapter.requests.at(-1)?.model, 'judge');
    assert.equal(scopedSettings(configSchema.parse(host.ctx.settings.describe().find(item => item.ns === 'dsh-agent-router')!.value), newParent.id), null);
    assert.ok(!host.ctx.tools.schemas(newParent).some(tool => tool.name === 'team_delegate'));
  } finally { await host.dispose(); }
});

test('chat workers preserve role verifier/fallback restrictions and catalog routes keep unknown prices', () => {
  const original = settings({ roles: [{ name: 'research', modelId: 'economy', verifierModelId: 'judge', fallbackModelId: 'capable', toolAllow: ['read_file'] }] });
  const choices = modelChoices(original.models);
  const selected = rememberPair(original, 'chat', choices[1], choices[2]);
  const scoped = scopedSettings(selected, 'chat')!;
  assert.deepEqual(scoped.roles[0], { ...original.roles[0], modelId: 'judge' });
  const custom = { value: routeKey({ provider: 'custom', model: 'new' }), provider: 'custom', model: 'new', name: 'New' };
  const added = rememberPair(selected, 'chat', choices[1], custom);
  assert.equal(added.models.at(-1)?.inputPrice, -1);
  assert.equal(added.models.at(-1)?.outputPrice, -1);
  assert.equal(rememberPair(added, 'chat-2', choices[1], custom).models.length, added.models.length);
  const defaultRole = scopedSettings({ ...added, roles: [] }, 'chat')!.roles[0];
  assert.equal(defaultRole.name, 'worker'); assert.equal(defaultRole.modelId, added.lastWorkerModelId);
  assert.equal(defaultRole.fallbackModelId, added.lastMainModelId);
});

test('first activation needs no predefined roles and supports separate arbitrary API providers', async () => {
  const adapter = new FixtureAdapter((options, index) => {
    if (options.provider === 'worker-api') return textResponse('extracted');
    if (index === 0) return toolResponse('team_roles', {});
    if (index === 1) return toolResponse('team_delegate', { role: 'worker', task: 'Extract.', acceptance: 'Use source.' });
    return textResponse('accepted');
  });
  const host = await settingsHarness(adapter);
  try {
    host.ctx.llm.registerAdapter(['main-api', 'worker-api'], adapter);
    const parent = await host.createParent();
    const initial = settings({ models: [], roles: [] });
    const choose = (provider: string, model: string) => ({ value: routeKey({ provider, model }), provider, model, name: model });
    const pair = rememberPair(initial, parent.id, choose('main-api', 'custom-main'), choose('worker-api', 'custom-worker'));
    await host.ctx.settings.update('dsh-agent-router', pair);
    await prompt(parent);
    assert.deepEqual(adapter.requests.map(item => [item.provider, item.model]), [
      ['main-api', 'custom-main'], ['main-api', 'custom-main'], ['worker-api', 'custom-worker'], ['main-api', 'custom-main'],
    ]);
    const discovery = parent.session.snapshotEvents().find(event => event.type === 'tool/result');
    assert.match(JSON.stringify(discovery), /"name.*worker/);
    assert.equal(host.ctx.sessionProjections.snapshot(parent.session).values.subagentCatalog?.length, 1);
  } finally { await host.dispose(); }
});
