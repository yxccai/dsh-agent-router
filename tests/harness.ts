import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import * as Router from '../src/index.ts';
import { configSchema, type Settings } from '../src/config.ts';

export function settings(overrides: Partial<Settings> = {}): Settings {
  return configSchema.parse({
    models: [
      { id: 'economy', provider: 'fixture', model: 'economy', inputPrice: 1, outputPrice: 2, cacheReadPrice: 0.1, cacheWritePrice: 1 },
      { id: 'capable', provider: 'fixture', model: 'capable', inputPrice: 10, outputPrice: 20, cacheReadPrice: 1, cacheWritePrice: 10 },
      { id: 'judge', provider: 'fixture', model: 'judge', inputPrice: 2, outputPrice: 4, cacheReadPrice: 0.2, cacheWritePrice: 2 },
    ],
    roles: [{ name: 'research', modelId: 'economy', fallbackModelId: 'capable' }],
    ...overrides,
  });
}

export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, reasoningTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}

export function toolResponse(name: string, args: object): StreamChunk[] {
  const id = ToolCallId(crypto.randomUUID()), json = JSON.stringify(args);
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: json },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: json } },
    { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ];
}

/** Only the network/model boundary is scripted; the DSH runtime remains real. */
export class FixtureAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  constructor(private readonly script: (options: GenerateOptions, index: number) => StreamChunk[]) { super(); }
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model }; }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted();
    const index = this.requests.push(options) - 1;
    for (const chunk of this.script(options, index)) yield chunk;
  }
}

export async function harness(adapter: LlmAdapter, config = settings(), plugin: typeof Router = Router, enabled = true) {
  const ctx = new Context();
  const parentId = SessionId(crypto.randomUUID());
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjectionRegistry);
    await ctx.plugin(SystemPrompt, {});
    await ctx.plugin(ToolRuntime, {});
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(SubagentRuntime, {});
    await ctx.plugin(Spawn, { providerName: 'spawn' });
    const router = await ctx.plugin(plugin, enabled ? { ...config, chatBindings: [{ sessionId: parentId, mainModelId: 'capable', workerModelId: 'economy' }] } : config);
    ctx.llm.registerAdapter(['fixture'], adapter);
    const parent = await ctx.agentLoop.create(parentId, { provider: 'fixture', model: 'capable' });
    return { ctx, parent, router };
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
