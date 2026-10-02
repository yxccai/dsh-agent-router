import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { Orchestrator } from '../src/orchestrator.ts';
import { FixtureAdapter, harness, settings, textResponse } from './harness.ts';

test('empty results exhaust only the configured attempts and remain rejected', async () => {
  const adapter = new FixtureAdapter(() => textResponse(''));
  const { ctx, parent } = await harness(adapter);
  try {
    const run = new Orchestrator((provider, request) => ctx.subagents.start(provider, request));
    const result = await run.run({ role: 'research', task: 'Answer.', acceptance: 'Nonempty evidence.', context: '' }, parent, new AbortController().signal, settings());
    assert.equal(result.accepted, false);
    assert.deepEqual(result.attempts.map(item => item.modelId), ['economy', 'economy', 'capable']);
    assert.equal(adapter.requests.length, 3);
  } finally { await ctx.fiber.dispose(); }
});

test('cancellation drains the real child before capacity can be used again', async () => {
  let reached!: () => void;
  const streaming = new Promise<void>(resolve => { reached = resolve; });
  class BlockingAdapter extends LlmAdapter {
    calls = 0;
    async resolveModel(provider: string, model: string) { return { provider, id: model, name: model }; }
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (++this.calls > 1) { yield* textResponse('second task'); return; }
      yield { type: 'block-start', index: 0, blockType: 'text' };
      reached();
      await new Promise<void>((_resolve, reject) => {
        const abort = () => { options.signal?.removeEventListener('abort', abort); reject(options.signal?.reason); };
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
      });
    }
  }
  const adapter = new BlockingAdapter();
  const { ctx, parent } = await harness(adapter);
  try {
    const run = new Orchestrator((provider, request) => ctx.subagents.start(provider, request));
    const config = settings({ maxParallel: 1 });
    const task = { role: 'research', task: 'Wait.', acceptance: 'Complete.', context: '' };
    const controller = new AbortController();
    const pending = run.run(task, parent, controller.signal, config);
    const rejected = assert.rejects(pending, /cancelled/);
    await streaming;
    await assert.rejects(run.run(task, parent, new AbortController().signal, config), /capacity/);
    controller.abort(new Error('cancelled'));
    await rejected;
    assert.equal(ctx.agents.list().length, 1);
    const next = await run.run(task, parent, new AbortController().signal, config);
    assert.equal(next.output, 'second task');
  } finally { await ctx.fiber.dispose(); }
});
