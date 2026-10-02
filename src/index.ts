import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session, SessionId } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-projection';
import { Config, readSettings } from './config.ts';
import { projection } from './projection.ts';
import { Budget, costOf } from './cost.ts';
import { Orchestrator, taskSchema } from './orchestrator.ts';
export { Config };
export const name = 'agent-router';
export const inject = ['tools', 'subagents', 'llm', 'sessions', 'sessionProjections'];
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** DSH Loader announces committed live configuration paths. */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void;
  }
}

/** Register delegation and native-log projections without changing prepared LLM inputs. */
export function apply(ctx: Context, config: Config): void {
  let settings = readSettings(config);
  let releaseProjection = ctx.sessionProjections.register(projection(settings));
  ctx.effect(() => () => releaseProjection());
  ctx.on('loader/volatile-update', () => {
    settings = readSettings(config);
    releaseProjection();
    releaseProjection = ctx.sessionProjections.register(projection(settings));
  });
  const budget = new Budget();
  ctx.on('agent/request', async (_payload, next) => {
    const proposal = await next();
    return settings.sessionBudget > 0
      ? { ...proposal, maxTokens: Math.min(proposal.maxTokens ?? settings.maxOutputTokens, settings.maxOutputTokens) }
      : proposal;
  });

  function rootOf(initial: Session): SessionId {
    let session = initial;
    const visited = new Set<string>();
    while (session.header.origin === 'subagent' && session.header.parentSession && !visited.has(session.id)) {
      visited.add(session.id);
      const parent = ctx.sessions.get(session.header.parentSession);
      if (!parent) break;
      session = parent;
    }
    return session.id;
  }

  ctx.on('llm/stream', async function* (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) {
    const current = settings;
    const session = options.sessionId ? ctx.sessions.get(options.sessionId) : undefined;
    const model = current.models.find(item => item.provider === options.provider && item.model === options.model);
    let settle: ((actual: number | null) => void) | undefined;
    if (session && current.sessionBudget > 0) {
      if (!model || options.messages.some(message => message.content.some(block => block.type === 'image'))) {
        throw new Error('Agent Router cannot reserve this request: configure model prices and use text-only requests with monetary budgets.');
      }
      const input = Buffer.byteLength(JSON.stringify({ messages: options.messages, system: options.system ?? '', tools: options.tools ?? [] }), 'utf8');
      if ([model.inputPrice, model.cacheReadPrice, model.cacheWritePrice, model.outputPrice].some(price => price < 0)) {
        throw new Error('Agent Router monetary budgets require all four price fields, including zero prices.');
      }
      const estimate = costOf({ inputTokens: input, outputTokens: options.maxTokens ?? current.maxOutputTokens }, {
        ...model, inputPrice: Math.max(model.inputPrice, model.cacheReadPrice, model.cacheWritePrice),
      });
      if (estimate === null) throw new Error('Agent Router requires uncached input and output prices to enforce a monetary budget.');
      const root = rootOf(session);
      const rootSession = ctx.sessions.get(root);
      if (!budget.has(root) && rootSession) {
        const history = ctx.sessionProjections.snapshot(rootSession).values;
        if ((history.agentRouter?.callCount ?? 0) > 0 || (history.subagentCatalog?.length ?? 0) > 0) {
          throw new Error('Agent Router budget reservations cannot be restored after reload. Start a new conversation, or disable the estimate budget to continue this one.');
        }
      }
      settle = budget.reserve(root, estimate, current.sessionBudget, current.finalReviewReserve, root !== session.id);
    }
    let usage: TokenUsage | undefined;
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'usage') usage = chunk.usage;
        yield chunk;
      }
    } finally { settle?.(costOf(usage, model)); }
  });

  const orchestrator = new Orchestrator((provider, request) => ctx.subagents.start(provider, request));
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'team_roles', description: 'List user-configured model roles before delegating with team_delegate. Model prices are user-supplied per million tokens. The main agent keeps planning and final acceptance. Prefer deterministic tools for mechanical work.',
    parameters: {}, isConcurrencySafe: () => true,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      const current = readSettings(config);
      return JSON.stringify({ roles: current.roles, models: current.models, maxParallel: current.maxParallel,
        qualityRetries: current.qualityRetries, instruction: 'Use low-cost roles for bounded tasks with checkable evidence. Review results yourself. accepted:null needs your acceptance; accepted:false is a failed delegation.' });
    },
  })));
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'team_delegate',
    description: 'Delegate a bounded, checkable task to a user-configured model role. Call team_roles to discover roles. Keep global planning and final acceptance in the main agent. Use direct tools for deterministic tasks. The selected role may verify, retry and escalate the result. Supply only relevant context; the child starts a fresh conversation. accepted:null means you must evaluate it; accepted:false means the delegation failed. Ask the user to configure roles if none exist.',
    parameters: {
      role: { type: 'string', required: true, description: 'Configured role name from Plugins → Agent Router.' },
      task: { type: 'string', required: true, description: 'Task goal and scope.' },
      acceptance: { type: 'string', required: true, description: 'Explicit acceptance criteria and evidence required.' },
      context: { type: 'string', description: 'Relevant source material or artifact references; avoid copying the full conversation.' },
    },
    isConcurrencySafe: () => true,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('team_delegate requires an active DSH agent.');
      const task = taskSchema.parse(args);
      const result = await orchestrator.run(task, exec.agent, exec.signal, readSettings(config));
      return JSON.stringify(result);
    },
  })));
}
