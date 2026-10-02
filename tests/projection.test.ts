import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session';
import { projection } from '../src/projection.ts';
import { FixtureAdapter, harness, settings, textResponse } from './harness.ts';
import { Orchestrator } from '../src/orchestrator.ts';

test('projection replay retains actual call identity and excludes fork-inherited charges', async () => {
  const adapter = new FixtureAdapter(() => textResponse('source result'));
  const { ctx, parent } = await harness(adapter);
  try {
    const captured = new Map<string, typeof parent.session>();
    ctx.on('session/event', session => { captured.set(session.id, session); });
    const result = await new Orchestrator((provider, request) => ctx.subagents.start(provider, request))
      .run({ role: 'research', task: 'Read.', acceptance: 'Answer.', context: '' }, parent, new AbortController().signal, settings());
    const source = captured.get(result.attempts[0].sessionId)!;
    const events = source.snapshotEvents();
    const fold = projection(settings());
    const replay = events.reduce((state, event) => fold.apply(state, event), fold.init(source.header, SessionLogOffset(0)));
    assert.deepEqual(replay.view, ctx.sessionProjections.snapshot(source).values.agentRouter);
    const forked = events.reduce((state, event) => fold.apply(state, event), fold.init({ ...source.header, id: SessionId('forked-fixture') }, SessionLogOffset(events.length)));
    assert.equal(forked.view.callCount, 0);
    assert.equal(forked.view.knownCost, 0);
    assert.equal(forked.view.sessionId, 'forked-fixture');
    const changed = projection(settings({ currency: 'CNY' }));
    assert.notEqual(fold.stateVersion, changed.stateVersion);
  } finally { await ctx.fiber.dispose(); }
});
