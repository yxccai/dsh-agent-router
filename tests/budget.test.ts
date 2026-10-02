import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { FixtureAdapter, harness, settings, textResponse } from './harness.ts';

test('enabled budget caps the logged request and blocks dispatch when reserve exceeds it', async () => {
  const adapter = new FixtureAdapter(() => textResponse('would cost money'));
  const { ctx, parent } = await harness(adapter, settings({ sessionBudget: 0.000001, maxOutputTokens: 128 }));
  try {
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Answer.' }], source: { kind: 'user' } }));
    await parent.whenIdle();
    assert.equal(adapter.requests.length, 0);
    const events = parent.session.snapshotEvents();
    const headers = events.filter(event => event.type === 'request/header');
    assert.ok(headers.length > 0);
    assert.equal(headers[0].data.header.config.maxTokens, 128);
    const view = ctx.sessionProjections.snapshot(parent.session).values.agentRouter!;
    assert.equal(view.state, 'failed');
    assert.equal(view.knownCost, 0);
    assert.ok(view.unknownCalls > 0);
  } finally { await ctx.fiber.dispose(); }
});

test('unpriced routes cannot be silently dispatched under an enabled budget', async () => {
  const adapter = new FixtureAdapter(() => textResponse('would cost money'));
  const config = settings({ sessionBudget: 10, models: settings().models.map(model => ({ ...model, cacheReadPrice: -1 })) });
  const { ctx, parent } = await harness(adapter, config);
  try {
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Answer.' }], source: { kind: 'user' } }));
    await parent.whenIdle();
    assert.equal(adapter.requests.length, 0);
    assert.equal(ctx.sessionProjections.snapshot(parent.session).values.agentRouter?.state, 'failed');
  } finally { await ctx.fiber.dispose(); }
});
