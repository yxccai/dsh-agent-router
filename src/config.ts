import s from '@deepseek-ai/schemastery';
import type { Volatile } from '@deepseek-ai/cordis';
import { configSchema, type Settings, type Model } from './settings-schema.ts';
export { configSchema, modelSchema, roleSchema, scopedSettings } from './settings-schema.ts';
export type { Settings, Model, Role, ChatBinding } from './settings-schema.ts';
export type Config = { [K in keyof Settings]: Volatile<Settings[K]> };

/** Live fields are exposed through DSH's native configuration forms. */
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
  lastMainModelId: s.string().default('').volatile(),
  lastWorkerModelId: s.string().default('').volatile(),
  chatBindings: s.array(s.object({
    sessionId: s.string().required(), mainModelId: s.string().required(), workerModelId: s.string().required(),
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
