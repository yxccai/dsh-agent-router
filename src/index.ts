import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions, StreamChunk, TokenUsage, LlmCallConfig } from '@deepseek-ai/dsh-llm';
import type { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-projection';
import { Config, readSettings, resolveModel, scopedSettings } from './config.ts';
import { projection } from './projection.ts';
import { Budget, costOf } from './cost.ts';
import { Orchestrator, taskSchema } from './orchestrator.ts';
export { Config };
export const name = 'agent-router';
export const inject = ['tools', 'subagents', 'llm', 'sessions', 'sessionProjections', 'agents'];
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** DSH Loader announces committed live configuration paths. */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void;
  }
}

/** Route opted-in chats before native request logging; observe finalized streams. */
export function apply(ctx: Context, config: Config): void {
  let settings = readSettings(config);
  let releaseProjection = ctx.sessionProjections.register(projection(settings));
  ctx.effect(() => () => releaseProjection());
  ctx.on('loader/volatile-update', () => {
    settings = readSettings(config);
    releaseProjection();
    releaseProjection = ctx.sessionProjections.register(projection(settings));
    for (const agent of ctx.agents.list()) updateVisibility(agent);
  });
  const budget = new Budget();
  ctx.on('agent/request', async ({ agent }, next) => {
    const proposal = await next();
    const root = rootOf(agent.session);
    const binding = settings.chatBindings.find(item => item.sessionId === root);
    if (!binding) return proposal;
    if (agent.id === root) {
      const main = resolveModel(settings, binding.mainModelId);
      const { reasoningEffort: _previousEffort, ...base } = proposal;
      const effort = main.reasoningEffort || (proposal.provider === main.provider && proposal.model === main.model ? proposal.reasoningEffort : undefined);
      return { ...base, provider: main.provider, model: main.model,
        ...(effort ? { reasoningEffort: effort as LlmCallConfig['reasoningEffort'] } : {}),
        ...(settings.sessionBudget > 0 ? { maxTokens: Math.min(proposal.maxTokens ?? settings.maxOutputTokens, settings.maxOutputTokens) } : {}) };
    }
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
    if (session && current.sessionBudget > 0 && current.chatBindings.some(item => item.sessionId === rootOf(session))) {
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
    async execute(_args, exec) {
      const current = exec.agent ? scopedSettings(readSettings(config), rootOf(exec.agent.session)) : null;
      if (!current) return JSON.stringify({ enabled: false, roles: [], instruction: 'Model delegation is off for this chat. The user can enable it beside the chat input. Do not delegate while it is off.' });
      return JSON.stringify({ enabled: true, roles: current.roles, models: current.models, maxParallel: current.maxParallel,
        qualityRetries: current.qualityRetries, instruction: 'Use low-cost roles for bounded tasks with checkable evidence. Review results yourself. accepted:null needs your acceptance; accepted:false is a failed delegation.' });
    },
  })));
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'team_delegate',
    description: 'Delegate a bounded, checkable task only when the user has enabled Model delegation beside the chat input. Call team_roles to discover roles. Keep global planning and final acceptance in the main agent. Use direct tools for deterministic tasks. The selected role may verify, retry and escalate the result. Supply only relevant context; the child starts a fresh conversation. accepted:null means you must evaluate it; accepted:false means the delegation failed.',
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
      const current = scopedSettings(readSettings(config), rootOf(exec.agent.session));
      if (!current) throw new Error('Model delegation is off for this chat. Enable it beside the chat input before using team_delegate.');
      const task = taskSchema.parse(args);
      const result = await orchestrator.run(task, exec.agent, exec.signal, current);
      return JSON.stringify(result);
    },
  })));
  const masks = new Map<Agent, () => void>();
  function updateVisibility(agent: Agent) {
    const enabled = settings.chatBindings.some(item => item.sessionId === rootOf(agent.session));
    if (enabled) { masks.get(agent)?.(); masks.delete(agent); }
    else if (!masks.has(agent)) masks.set(agent, agent.ctx.tools.restrict({ deny: ['team_roles', 'team_delegate'] }));
  }
  for (const agent of ctx.agents.list()) updateVisibility(agent);
  ctx.on('agent/created', ({ agent }) => { updateVisibility(agent); return undefined; });
  ctx.on('agent/disposed', ({ agent }) => { masks.get(agent)?.(); masks.delete(agent); });
  ctx.effect(() => () => { for (const release of masks.values()) release(); masks.clear(); });
}
