import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { CatalogAdapter } from './catalog-adapter.ts';
import { settingsHarness } from './settings-harness.ts';
import { nativeModelHost } from './native-model-host.ts';
import { textResponse, toolResponse } from './harness.ts';

test('native main selections route actual root/child requests while saved preferences are stale', async () => {
  const adapter = new CatalogAdapter((options, index) => index === 0
    ? toolResponse('team_delegate', { role: 'worker', task: 'Extract.', acceptance: 'Use source.' })
    : textResponse(options.model));
  const host = await settingsHarness(adapter);
  try {
    const parent = await host.createParent(), native = await nativeModelHost(host.ctx, host.profile.cwd);
    native.attach(parent);
    await host.ctx.settings.update('dsh-agent-router', {
      roles: [], chatBindings: [{ sessionId: parent.id, mainModelId: 'capable', workerModelId: 'economy' }],
    });
    await native.select({ sessionId: parent.id, provider: 'fixture', model: 'judge' });
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Delegate.' }], source: { kind: 'user' } }));
    await parent.whenIdle();
    assert.deepEqual(adapter.requests.map(request => request.model), ['judge', 'economy', 'judge']);
    assert.equal(native.snapshot(parent).next?.model, 'judge');
    assert.ok(parent.session.snapshotEvents().some(event => event.type === 'model/selection' && event.data.model === 'judge'));
  } finally { await host.dispose(); }
});

test('the automatic worker escalates to the native main model before preference persistence', async () => {
  const adapter = new CatalogAdapter((options, index) => index === 0
    ? toolResponse('team_delegate', { role: 'worker', task: 'Extract.', acceptance: 'Use source.' })
    : textResponse(options.model === 'economy' ? '' : 'done'));
  const host = await settingsHarness(adapter);
  try {
    const parent = await host.createParent(), native = await nativeModelHost(host.ctx, host.profile.cwd);
    native.attach(parent);
    await host.ctx.settings.update('dsh-agent-router', {
      roles: [], qualityRetries: 0, chatBindings: [{ sessionId: parent.id, mainModelId: 'capable', workerModelId: 'economy' }],
    });
    await native.select({ sessionId: parent.id, provider: 'fixture', model: 'judge' });
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Delegate.' }], source: { kind: 'user' } }));
    await parent.whenIdle();
    assert.deepEqual(adapter.requests.map(request => request.model), ['judge', 'economy', 'judge', 'judge']);
  } finally { await host.dispose(); }
});

test('native defaults own a blank enabled chat before any explicit selection event', async () => {
  const adapter = new CatalogAdapter(() => textResponse('done'));
  const host = await settingsHarness(adapter);
  try {
    const parent = await host.createParent(), native = await nativeModelHost(host.ctx, host.profile.cwd, { provider: 'fixture', model: 'judge' });
    native.attach(parent);
    await host.ctx.settings.update('dsh-agent-router', {
      chatBindings: [{ sessionId: parent.id, mainModelId: 'capable', workerModelId: 'economy' }],
    });
    assert.equal(native.snapshot(parent).next, null);
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run.' }], source: { kind: 'user' } }));
    await parent.whenIdle();
    assert.deepEqual(adapter.requests.map(request => request.model), ['judge']);
  } finally { await host.dispose(); }
});

test('an unsaved native route from another provider is a usable unpriced automatic fallback', async () => {
  const adapter = new CatalogAdapter((options, index) => index === 0
    ? toolResponse('team_delegate', { role: 'worker', task: 'Extract.', acceptance: 'Use source.' })
    : textResponse(options.model === 'economy' ? '' : 'done'));
  const host = await settingsHarness(adapter);
  try {
    host.ctx.llm.registerAdapter(['external'], adapter);
    const parent = await host.createParent(), native = await nativeModelHost(host.ctx, host.profile.cwd);
    native.attach(parent);
    await host.ctx.settings.update('dsh-agent-router', {
      roles: [], qualityRetries: 0, chatBindings: [{ sessionId: parent.id, mainModelId: 'capable', workerModelId: 'economy' }],
    });
    await native.select({ sessionId: parent.id, provider: 'external', model: 'capable' });
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Delegate.' }], source: { kind: 'user' } }));
    await parent.whenIdle();
    assert.deepEqual(adapter.requests.map(({ provider, model }) => [provider, model]), [
      ['external', 'capable'], ['fixture', 'economy'], ['external', 'capable'], ['external', 'capable'],
    ]);
    const saved = host.ctx.settings.describe().find(item => item.ns === 'dsh-agent-router')!.value as { models: { provider: string }[] };
    assert.ok(saved.models.every(model => model.provider === 'fixture'), 'Ephemeral fallback resolution must not change the saved form.');
  } finally { await host.dispose(); }
});

test('switching during an assembled request takes effect on the next step', async () => {
  const adapter = new CatalogAdapter(() => textResponse('done'));
  const host = await settingsHarness(adapter);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const parent = await host.createParent(), native = await nativeModelHost(host.ctx, host.profile.cwd);
    native.attach(parent);
    await host.ctx.settings.update('dsh-agent-router', {
      chatBindings: [{ sessionId: parent.id, mainModelId: 'capable', workerModelId: 'economy' }],
    });
    await native.select({ sessionId: parent.id, provider: 'fixture', model: 'capable' });
    let reached!: () => void;
    const assembled = new Promise<void>(resolve => { reached = resolve; });
    const dispose = parent.ctx.on('agent/request', async (_payload, next) => {
      const proposal = await next(); reached(); await gate; return proposal;
    });
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'First.' }], source: { kind: 'user' } }));
    await assembled;
    await native.select({ sessionId: parent.id, provider: 'fixture', model: 'judge' });
    release(); await parent.whenIdle(); dispose();
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Second.' }], source: { kind: 'user' } }));
    await parent.whenIdle();
    assert.deepEqual(adapter.requests.map(request => request.model), ['capable', 'judge']);
  } finally { release(); await host.dispose(); }
});
