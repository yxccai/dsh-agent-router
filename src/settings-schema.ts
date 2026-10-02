import { z } from 'zod';
const price = z.number().finite().min(-1).default(-1);
export const modelSchema = z.object({
  id: z.string().min(1), provider: z.string().min(1), model: z.string().min(1),
  reasoningEffort: z.string().default(''), maxTokens: z.number().int().positive().default(4096),
  inputPrice: price, outputPrice: price, cacheReadPrice: price, cacheWritePrice: price,
}).strict();
export const roleSchema = z.object({
  name: z.string().min(1), modelId: z.string().min(1), fallbackModelId: z.string().default(''),
  verifierModelId: z.string().default(''), toolAllow: z.array(z.string()).default([]),
}).strict();
export const bindingSchema = z.object({
  sessionId: z.string().min(1), mainModelId: z.string().min(1), workerModelId: z.string().min(1),
}).strict();
export const configSchema = z.object({
  subagentProvider: z.string().min(1).default('spawn'), maxDepth: z.number().int().min(1).max(8).default(1),
  maxParallel: z.number().int().min(1).max(32).default(3), qualityRetries: z.number().int().min(0).max(3).default(1),
  maxOutputTokens: z.number().int().min(128).max(131072).default(4096), historyLimit: z.number().int().min(10).max(2000).default(200),
  sessionBudget: z.number().finite().nonnegative().default(0), finalReviewReserve: z.number().finite().nonnegative().default(0),
  currency: z.string().length(3).default('USD'), models: z.array(modelSchema).default([]), roles: z.array(roleSchema).default([]),
  lastMainModelId: z.string().default(''), lastWorkerModelId: z.string().default(''),
  chatBindings: z.array(bindingSchema).default([]),
}).strict().superRefine((config, ctx) => {
  const ids = new Set<string>(), routes = new Set<string>(), names = new Set<string>(), chats = new Set<string>();
  for (const [index, model] of config.models.entries()) {
    if (ids.has(model.id)) ctx.addIssue({ code: 'custom', path: ['models', index, 'id'], message: 'Model IDs must be unique.' });
    ids.add(model.id);
    const route = JSON.stringify([model.provider, model.model]);
    if (routes.has(route)) ctx.addIssue({ code: 'custom', path: ['models', index, 'model'], message: 'Each provider/model route must have one price definition.' });
    routes.add(route);
  }
  const reference = (id: string, path: (string | number)[]) => {
    if (id && !ids.has(id)) ctx.addIssue({ code: 'custom', path, message: 'Select a configured model ID.' });
  };
  for (const [index, role] of config.roles.entries()) {
    if (names.has(role.name)) ctx.addIssue({ code: 'custom', path: ['roles', index, 'name'], message: 'Role names must be unique.' });
    names.add(role.name);
    for (const field of ['modelId', 'fallbackModelId', 'verifierModelId'] as const) reference(role[field], ['roles', index, field]);
  }
  for (const field of ['lastMainModelId', 'lastWorkerModelId'] as const) reference(config[field], [field]);
  for (const [index, binding] of config.chatBindings.entries()) {
    if (chats.has(binding.sessionId)) ctx.addIssue({ code: 'custom', path: ['chatBindings', index, 'sessionId'], message: 'Each chat can have one active model pair.' });
    chats.add(binding.sessionId);
    reference(binding.mainModelId, ['chatBindings', index, 'mainModelId']);
    reference(binding.workerModelId, ['chatBindings', index, 'workerModelId']);
  }
  if (config.sessionBudget > 0 && config.finalReviewReserve >= config.sessionBudget) {
    ctx.addIssue({ code: 'custom', path: ['finalReviewReserve'], message: 'Review reserve must be smaller than the session budget.' });
  }
});
export type Settings = z.infer<typeof configSchema>;
export type Model = z.infer<typeof modelSchema>;
export type Role = z.infer<typeof roleSchema>;
export type ChatBinding = z.infer<typeof bindingSchema>;

/** A selected chat pair supplies initial workers; role-specific checks and fallback remain configurable. */
export function scopedSettings(config: Settings, sessionId: string): Settings | null {
  const binding = config.chatBindings.find(item => item.sessionId === sessionId);
  if (!binding) return null;
  return { ...config, roles: config.roles.length
    ? config.roles.map(role => ({ ...role, modelId: binding.workerModelId }))
    : [{ name: 'worker', modelId: binding.workerModelId, fallbackModelId: binding.mainModelId === binding.workerModelId ? '' : binding.mainModelId, verifierModelId: '', toolAllow: [] }] };
}
