import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { Orchestrator } from '../src/orchestrator.ts';
import { FixtureAdapter, harness, settings, textResponse, toolResponse } from './harness.ts';

test('real spawn uses configured route, native lineage, usage and disposal', async () => {
  const adapter = new FixtureAdapter(() => textResponse('Answer with checkable evidence.'));
  const { ctx, parent, router } = await harness(adapter);
  try {
    const captures = new Map<string, typeof parent.session>();
    ctx.on('session/event', session => { captures.set(session.id, session); });
    const run = new Orchestrator((provider, request) => ctx.subagents.start(provider, request));
    const result = await run.run({ role: 'research', task: 'Read the supplied text.', acceptance: 'Cite the supplied text.', context: 'source' }, parent, new AbortController().signal, settings());
    assert.equal(result.accepted, null);
    assert.equal(result.attempts.length, 1);
    const id = result.attempts[0].sessionId;
    assert.equal(adapter.requests[0].model, 'economy');
    const child = captures.get(id)!;
    assert.equal(child.header.parentSession, parent.id);
    const view = ctx.sessionProjections.snapshot(child).values.agentRouter!;
    assert.equal(view.sessionId, id);
    assert.equal(view.model, 'economy');
    assert.equal(view.state, 'completed');
    assert.equal(view.callCount, 1);
    assert.equal(view.knownCost, 0.000148);
    assert.equal(view.unknownCalls, 0);
    assert.equal(ctx.agents.get(SessionId(id)), undefined);
    assert.equal(ctx.sessionProjections.snapshot(parent.session).values.subagentCatalog?.length, 1);
    await router.dispose();
    assert.equal(ctx.sessionProjections.snapshot(child).values.agentRouter, undefined);
    assert.equal(ctx.tools.get('team_delegate'), undefined);
    assert.equal(ctx.tools.get('team_roles'), undefined);
  } finally { await ctx.fiber.dispose(); }
});

test('a failed verifier triggers bounded retries then the configured fallback', async () => {
  let reviews = 0;
  const adapter = new FixtureAdapter(options => {
    if (options.model === 'judge') return toolResponse('structured_output', { passed: ++reviews === 3, feedback: 'Provide the required source.' });
    return textResponse('candidate');
  });
  const config = settings({ roles: [{ name: 'research', modelId: 'economy', fallbackModelId: 'capable', verifierModelId: 'judge', toolAllow: [] }] });
  const { ctx, parent } = await harness(adapter, config);
  try {
    const run = new Orchestrator((provider, request) => ctx.subagents.start(provider, request));
    const result = await run.run({ role: 'research', task: 'Summarize.', acceptance: 'Cite evidence.', context: 'source' }, parent, new AbortController().signal, config);
    assert.equal(result.accepted, true);
    assert.deepEqual(result.attempts.map(item => item.modelId), ['economy', 'economy', 'capable']);
    assert.equal(new Set(result.attempts.flatMap(item => [item.sessionId, item.verifierSessionId])).size, 6);
    assert.deepEqual(adapter.requests.map(item => item.model), ['economy', 'judge', 'economy', 'judge', 'capable', 'judge']);
    assert.equal(ctx.sessionProjections.snapshot(parent.session).values.subagentCatalog?.length, 6);
    for (const attempt of result.attempts) {
      assert.equal(ctx.agents.get(attempt.sessionId as typeof parent.id), undefined);
      assert.equal(ctx.agents.get(attempt.verifierSessionId as typeof parent.id), undefined);
    }
  } finally { await ctx.fiber.dispose(); }
});

test('the main loop discovers roles, delegates through the real tool, and keeps its model', async () => {
  const adapter = new FixtureAdapter((options, index) => {
    if (options.model === 'economy') return textResponse('delegated result');
    if (index === 0) return toolResponse('team_roles', {});
    if (index === 1) return toolResponse('team_delegate', { role: 'research', task: 'Extract a fact.', acceptance: 'Match source.', context: 'Fact: 42' });
    return textResponse('Main agent acceptance.');
  });
  const { ctx, parent } = await harness(adapter);
  try {
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Plan and delegate the extraction.' }], source: { kind: 'user' } }));
    await parent.whenIdle();
    assert.deepEqual(adapter.requests.map(item => item.model), ['capable', 'capable', 'economy', 'capable']);
    const events = parent.session.snapshotEvents();
    const results = events.filter(event => event.type === 'tool/result');
    assert.equal(results.length, 2);
    assert.equal(ctx.sessionProjections.snapshot(parent.session).values.agentRouter?.callCount, 3);
    assert.equal(ctx.sessionProjections.snapshot(parent.session).values.subagentCatalog?.length, 1);
    assert.ok(adapter.requests[2].messages.every(message => !JSON.stringify(message).includes('Plan and delegate the extraction.')));
  } finally { await ctx.fiber.dispose(); }
});
