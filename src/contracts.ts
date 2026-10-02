import { z } from 'zod';

const usageSchema = z.object({ inputTokens: z.number(), outputTokens: z.number(), cacheReadTokens: z.number().optional(), cacheWriteTokens: z.number().optional(), reasoningTokens: z.number().optional(), totalTokens: z.number().optional() });
export const callSchema = z.object({
  id: z.string(), provider: z.string(), model: z.string(), startedAt: z.number(), endedAt: z.number().optional(),
  state: z.enum(['running', 'completed', 'failed', 'cancelled']), usage: usageSchema.optional(), cost: z.number().nullable(),
});
export const viewSchema = z.object({
  sessionId: z.string(), parentId: z.string().nullable(), label: z.string(), model: z.string(), provider: z.string(),
  state: z.enum(['created', 'running', 'waiting', 'completed', 'failed', 'cancelled']),
  calls: z.array(callSchema), callCount: z.number(), knownCost: z.number(), unknownCalls: z.number(), currency: z.string(),
});
export type AgentView = z.infer<typeof viewSchema>;
export type Call = z.infer<typeof callSchema>;
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { agentRouter: AgentView }
}
