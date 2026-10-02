import { z } from 'zod';
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { Settings, Model } from './config.ts';
import { costOf } from './cost.ts';
import { createHash } from 'node:crypto';
import { viewSchema, type Call } from './contracts.ts';
const stateSchema = z.object({ view: viewSchema, inheritedCut: z.number(), pendingAt: z.number().nullable(), turn: z.number(), step: z.number() });
export type RouterState = z.infer<typeof stateSchema>;

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { agentRouter: RouterState }
}

/** Derive identity, route, state and costs solely from committed native DSH events. */
export function projection(config: Settings) {
  const routes = new Map<string, Model>(config.models.map(model => [JSON.stringify([model.provider, model.model]), model]));
  return {
    key: 'agentRouter' as const, stateVersion: parseInt(createHash('sha256').update(JSON.stringify([1, config.models, config.currency, config.historyLimit])).digest('hex').slice(0, 12), 16), stateSchema,
    init(header: SessionHeader, inheritedCut: SessionLogOffset): RouterState {
      return { inheritedCut, pendingAt: null, turn: 0, step: 0, view: {
        sessionId: header.id, parentId: header.origin === 'subagent' ? header.parentSession ?? null : null,
        label: '', model: '', provider: '', state: 'created', calls: [], callCount: 0,
        knownCost: 0, unknownCalls: 0, currency: config.currency,
      } };
    },
    apply(state: RouterState, event: SessionEvent): RouterState {
      if (event.seq < state.inheritedCut) return state;
      const view = state.view;
      switch (event.type) {
        case 'subagent/descriptor': return { ...state, view: { ...view, label: event.data.label ?? '' } };
        case 'request/header': return { ...state, view: { ...view, provider: event.data.header.config.provider, model: event.data.header.config.model } };
        case 'turn/start': return { ...state, view: { ...view, state: 'running' } };
        case 'step/start': return { ...state, pendingAt: event.time, turn: event.data.turn, step: event.data.step, view: { ...view, state: 'running' } };
        case 'tool/call': return { ...state, view: { ...view, state: 'waiting' } };
        case 'assistant/message':
        case 'assistant/attempt': {
          if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') return state;
          const model = routes.get(JSON.stringify([view.provider, view.model]));
          const usage = event.type === 'assistant/message' ? event.data.usage
            : event.data.stream.findLast(record => record.type === 'chunk' && record.chunk.type === 'usage');
          const tokens = usage && 'type' in usage && usage.type === 'chunk' && usage.chunk.type === 'usage' ? usage.chunk.usage : usage && 'inputTokens' in usage ? usage : undefined;
          const cost = costOf(tokens, model);
          const failed = event.type === 'assistant/attempt';
          const call: Call = { id: `${view.sessionId}:${event.seq}`, provider: view.provider, model: view.model,
            startedAt: state.pendingAt ?? event.time, endedAt: event.time, state: failed ? 'failed' : 'completed', cost,
            ...(tokens ? { usage: tokens } : {}) };
          return { ...state, pendingAt: null, view: { ...view, calls: [...view.calls, call].slice(-config.historyLimit),
            callCount: view.callCount + 1, knownCost: view.knownCost + (cost ?? 0), unknownCalls: view.unknownCalls + (cost === null ? 1 : 0) } };
        }
        case 'turn/end': return { ...state, pendingAt: null, view: { ...view, state: event.data.reason.kind === 'completed' ? 'completed' : event.data.reason.kind === 'aborted' ? 'cancelled' : 'failed' } };
        default: return state;
      }
    },
    wire: { viewSchema, view: (state: RouterState) => state.view },
  } satisfies ProjectionDefinition<'agentRouter'>;
}
