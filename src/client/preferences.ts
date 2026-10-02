import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { ModelSelection, ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types';
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import { configSchema, modelSchema, type Settings, type Model } from '../settings-schema.ts';

export type SettingsForm = ConfigForm<Settings>;
export type ModelDirectoryHandle = Pick<ModelDirectory, 'store' | 'load'>;
export const routeKey = (route: Pick<Model, 'provider' | 'model'>) => JSON.stringify([route.provider, route.model]);
export interface Choice { value: string; name: string; provider: string; providerName?: string; model: string; effort?: string }

export function useSettings(form: SettingsForm) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form]);
  const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const parsed = useMemo(() => configSchema.safeParse(state.value), [state.value]);
  return { state, settings: state.value && parsed.success ? parsed.data : null };
}

/** Keep explicitly configured routes selectable when a catalog is incomplete. */
export function modelChoices(models: Model[], catalog?: { groups: readonly ModelProviderGroup[] }, current?: ModelSelection | null): Choice[] {
  const choices = new Map<string, Choice>();
  for (const group of catalog?.groups ?? []) for (const model of group.models) {
    const value = routeKey({ provider: group.id, model: model.id });
    choices.set(value, { value, name: model.name, provider: group.id, providerName: group.name, model: model.id, effort: model.reasoning?.defaultEffort });
  }
  for (const model of models) {
    const value = routeKey(model);
    choices.set(value, { ...choices.get(value), value, name: choices.get(value)?.name ?? model.model, provider: model.provider, providerName: choices.get(value)?.providerName ?? model.provider, model: model.model, effort: model.reasoningEffort });
  }
  if (current && !models.some(model => routeKey(model) === routeKey(current))) {
    const value = routeKey(current);
    const existing = choices.get(value);
    choices.set(value, { value, name: existing?.name ?? current.model, provider: current.provider, providerName: existing?.providerName ?? current.provider, model: current.model, effort: current.reasoningEffort ?? existing?.effort });
  }
  return [...choices.values()];
}

/** Add catalog routes without inventing prices or replacing configured reasoning. */
export function rememberPair(settings: Settings, sessionId: string, main: Choice, worker: Choice): Settings {
  const models = [...settings.models];
  function resolve(choice: Choice) {
    const found = models.find(model => routeKey(model) === choice.value);
    if (found) return found.id;
    let number = 1;
    while (models.some(model => model.id === `model-${number}`)) number++;
    const model = modelSchema.parse({ id: `model-${number}`, provider: choice.provider, model: choice.model, reasoningEffort: choice.effort ?? '' });
    models.push(model);
    return model.id;
  }
  const mainModelId = resolve(main), workerModelId = resolve(worker);
  return configSchema.parse({ ...settings, models, lastMainModelId: mainModelId, lastWorkerModelId: workerModelId,
    chatBindings: [...settings.chatBindings.filter(binding => binding.sessionId !== sessionId), { sessionId, mainModelId, workerModelId }] });
}
