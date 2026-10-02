import s from '@deepseek-ai/schemastery';
import { z } from 'zod';
import type { Volatile } from '@deepseek-ai/cordis';

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
export const configSchema = z.object({
  subagentProvider: z.string().min(1).default('spawn'), maxDepth: z.number().int().min(1).max(8).default(1),
  maxParallel: z.number().int().min(1).max(32).default(3), qualityRetries: z.number().int().min(0).max(3).default(1),
  maxOutputTokens: z.number().int().min(128).max(131072).default(4096),
  historyLimit: z.number().int().min(10).max(2000).default(200),
  sessionBudget: z.number().finite().nonnegative().default(0),
  finalReviewReserve: z.number().finite().nonnegative().default(0),
  currency: z.string().length(3).default('USD'),
  models: z.array(modelSchema).default([]), roles: z.array(roleSchema).default([]),
}).strict().superRefine((config, ctx) => {
  const ids = new Set<string>();
  const routes = new Set<string>();
  for (const [index, model] of config.models.entries()) {
    if (ids.has(model.id)) ctx.addIssue({ code: 'custom', path: ['models', index, 'id'], message: 'Model IDs must be unique.' });
    ids.add(model.id);
    const route = JSON.stringify([model.provider, model.model]);
    if (routes.has(route)) ctx.addIssue({ code: 'custom', path: ['models', index, 'model'], message: 'Each provider/model route must have one price definition.' });
    routes.add(route);
  }
  const names = new Set<string>();
  for (const [index, role] of config.roles.entries()) {
    if (names.has(role.name)) ctx.addIssue({ code: 'custom', path: ['roles', index, 'name'], message: 'Role names must be unique.' });
    names.add(role.name);
    for (const field of ['modelId', 'fallbackModelId', 'verifierModelId'] as const) {
      if (role[field] && !ids.has(role[field])) ctx.addIssue({ code: 'custom', path: ['roles', index, field], message: 'Select a configured model ID.' });
    }
  }
  if (config.sessionBudget > 0 && config.finalReviewReserve >= config.sessionBudget) {
    ctx.addIssue({ code: 'custom', path: ['finalReviewReserve'], message: 'Review reserve must be smaller than the session budget.' });
  }
});

export type Settings = z.infer<typeof configSchema>;
export type Model = z.infer<typeof modelSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Config = { [K in keyof Settings]: Volatile<Settings[K]> };

/** Live fields are exposed by DSH's existing plugin configuration editor. */
export const Config = s.object({
  subagentProvider: s.string().default('spawn').volatile(),
  maxDepth: s.number().step(1).min(1).max(8).default(1).volatile(),
  maxParallel: s.number().step(1).min(1).max(32).default(3).volatile(),
  qualityRetries: s.number().step(1).min(0).max(3).default(1).volatile(),
  maxOutputTokens: s.number().step(1).min(128).max(131072).default(4096).volatile(),
  historyLimit: s.number().step(1).min(10).max(2000).default(200).volatile(),
  sessionBudget: s.number().min(0).default(0).volatile(),
  finalReviewReserve: s.number().min(0).default(0).volatile(),
  currency: s.string().default('USD').volatile(),
  models: s.array(s.object({
    id: s.string().required(), provider: s.string().required(), model: s.string().required(),
    reasoningEffort: s.string().default(''), maxTokens: s.number().step(1).min(1).default(4096),
    inputPrice: s.number().min(-1).default(-1), outputPrice: s.number().min(-1).default(-1),
    cacheReadPrice: s.number().min(-1).default(-1), cacheWritePrice: s.number().min(-1).default(-1),
  })).default([]).volatile(),
  roles: s.array(s.object({
    name: s.string().required(), modelId: s.string().required(),
    fallbackModelId: s.string().default(''), verifierModelId: s.string().default(''),
    toolAllow: s.array(s.string()).default([]),
  })).default([]).volatile(),
});

/** Validate a consistent snapshot of all live settings before starting work. */
export function readSettings(config: Config): Settings {
  return configSchema.parse(Object.fromEntries(Object.entries(config).map(([key, value]) => [key, value.get()])));
}

/** Resolve a role's configured model; missing references never inherit another model. */
export function resolveModel(config: Settings, id: string): Model {
  const model = config.models.find(item => item.id === id);
  if (!model) throw new Error(`Unknown model ID: ${id}. Configure it in Plugins → Agent Router.`);
  return model;
}
