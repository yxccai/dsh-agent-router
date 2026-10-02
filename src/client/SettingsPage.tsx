import { useEffect, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { configSchema, modelSchema, roleSchema, type Settings, type Model, type Role } from '../settings-schema.ts';
import { useSettings, type SettingsForm } from './preferences.ts';

const editable = ['models', 'roles', 'subagentProvider', 'maxDepth', 'maxParallel', 'qualityRetries', 'maxOutputTokens', 'historyLimit', 'sessionBudget', 'finalReviewReserve', 'currency'] as const;
type Draft = Pick<Settings, typeof editable[number]>;
export function SettingsPage({ form, t }: { form: SettingsForm } & PropsLocale<'agentRouter'>) {
  const { state, settings } = useSettings(form);
  const [draft, setDraft] = useState<Draft>(), [revision, setRevision] = useState<number>(), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const reset = () => {
    if (!settings) return;
    setDraft(structuredClone(settings)); setRevision(state.revision); setDirty(false); setError(''); setNotice('');
  };
  useEffect(() => {
    if (!dirty && settings) { setDraft(structuredClone(settings)); setRevision(state.revision); }
  }, [state.value, state.revision, dirty]);
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(previous => previous && { ...previous, [key]: value }); setDirty(true); setNotice(''); setError('');
  }
  if (!draft || !settings) return <div className="dar-form-note" role="status">{t(state.status === 'loading' ? 'loadingSettings' : 'settingsUnavailable')}</div>;
  const disabled = busy || !state.writable || state.status !== 'ready';
  function modelField<K extends keyof Model>(index: number, key: K, value: Model[K]) {
    update('models', draft!.models.map((model, i) => i === index ? { ...model, [key]: value } : model));
  }
  function roleField<K extends keyof Role>(index: number, key: K, value: Role[K]) {
    update('roles', draft!.roles.map((role, i) => i === index ? { ...role, [key]: value } : role));
  }
  async function save() {
    if (disabled || !draft || !settings) return;
    const parsed = configSchema.safeParse({ ...settings, ...Object.fromEntries(editable.map(field => [field, draft[field]])) });
    if (!parsed.success) { setError(`${t('invalidSettings')} ${parsed.error.issues[0]?.path.join('.') ?? ''}`); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      if (!await form.mutate(editable.map(field => ({ op: 'set', path: [field], value: parsed.data[field] })), revision)) setError(t('saveFailed'));
      else { setDirty(false); setNotice(t('saved')); }
    } catch { setError(t('saveFailed')); }
    finally { setBusy(false); }
  }
  const refs = new Set([settings.lastMainModelId, settings.lastWorkerModelId, ...settings.chatBindings.flatMap(item => [item.mainModelId, item.workerModelId]), ...draft.roles.flatMap(role => [role.modelId, role.fallbackModelId, role.verifierModelId])]);
  const modelOptions = draft.models.map(model => <option key={model.id} value={model.id}>{model.id} · {model.model}</option>);
  return <div className="dar-settings">
    <p className="dar-form-note">{t('setupHelp')}</p>
    <fieldset disabled={disabled}>
      <div className="dar-section-heading"><span>{t('models')}</span><button type="button" className="dar-link" onClick={() => {
        let number = 1; while (draft.models.some(model => model.id === `model-${number}`)) number++;
        update('models', [...draft.models, modelSchema.parse({ id: `model-${number}`, provider: 'provider', model: 'model' })]);
      }}>{t('addModel')}</button></div>
      {!draft.models.length && <p className="dar-form-note">{t('modelsHelp')}</p>}
      {draft.models.map((model, index) => <div className="dar-model-card" key={index}>
        <div className="dar-field-grid">
          <label>{t('modelId')}<input aria-label={`${t('modelId')} ${index + 1}`} value={model.id} onChange={event => modelField(index, 'id', event.target.value)} /></label>
          <label>{t('provider')}<input aria-label={`${t('provider')} ${index + 1}`} value={model.provider} onChange={event => modelField(index, 'provider', event.target.value)} /></label>
          <label>{t('model')}<input aria-label={`${t('model')} ${index + 1}`} value={model.model} onChange={event => modelField(index, 'model', event.target.value)} /></label>
        </div>
        <details><summary>{t('pricesAndLimits')}</summary><p className="dar-form-note">{t('priceHelp', { currency: draft.currency })}</p>
          <div className="dar-field-grid">
            {(['inputPrice', 'outputPrice', 'cacheReadPrice', 'cacheWritePrice'] as const).map(field => <label key={field}>{t(field)}<input type="number" min={-1} step="any" value={model[field]} onChange={event => modelField(index, field, Number(event.target.value))} /></label>)}
            <label>{t('modelMaxTokens')}<input type="number" min={1} step={1} value={model.maxTokens} onChange={event => modelField(index, 'maxTokens', Number(event.target.value))} /></label>
            <label>{t('reasoningEffort')}<input value={model.reasoningEffort} onChange={event => modelField(index, 'reasoningEffort', event.target.value)} /></label>
          </div>
        </details>
        <button type="button" className="dar-link" disabled={refs.has(model.id)} title={refs.has(model.id) ? t('modelInUse') : undefined} onClick={() => update('models', draft.models.filter((_, i) => i !== index))}>{t('remove')}</button>
      </div>)}
      <details className="dar-settings-section"><summary>{t('rolesAndChecks')}</summary><p className="dar-form-note">{t('rolesHelp')}</p>
        {draft.roles.map((role, index) => <div className="dar-model-card" key={index}>
          <div className="dar-field-grid">
            <label>{t('roleName')}<input value={role.name} onChange={event => roleField(index, 'name', event.target.value)} /></label>
            <label>{t('workerModel')}<select value={role.modelId} onChange={event => roleField(index, 'modelId', event.target.value)}><option value="">{t('chooseModel')}</option>{modelOptions}</select></label>
            {(['fallbackModelId', 'verifierModelId'] as const).map(field => <label key={field}>{t(field)}<select value={role[field]} onChange={event => roleField(index, field, event.target.value)}><option value="">{t('none')}</option>{modelOptions}</select></label>)}
            <label className="dar-full-field">{t('toolAllow')}<input value={role.toolAllow.join(', ')} onChange={event => roleField(index, 'toolAllow', event.target.value.split(',').map(value => value.trim()).filter(Boolean))} /></label>
          </div>
          <button type="button" className="dar-link" onClick={() => update('roles', draft.roles.filter((_, i) => i !== index))}>{t('remove')}</button>
        </div>)}
        <button type="button" className="dar-link" onClick={() => update('roles', [...draft.roles, roleSchema.parse({ name: `role-${draft.roles.length + 1}`, modelId: draft.models[0]?.id ?? 'model' })])}>{t('addRole')}</button>
      </details>
      <details className="dar-settings-section"><summary>{t('advanced')}</summary><div className="dar-field-grid">
        <label>{t('subagentProvider')}<input value={draft.subagentProvider} onChange={event => update('subagentProvider', event.target.value)} /></label>
        <label>{t('currency')}<input value={draft.currency} maxLength={3} onChange={event => update('currency', event.target.value.toUpperCase())} /></label>
        {(['maxParallel', 'qualityRetries', 'maxDepth', 'maxOutputTokens', 'historyLimit', 'sessionBudget', 'finalReviewReserve'] as const).map(field => <label key={field}>{t(field)}<input type="number" min={0} step={field === 'sessionBudget' || field === 'finalReviewReserve' ? 'any' : 1} value={draft[field]} onChange={event => update(field, Number(event.target.value))} /></label>)}
      </div><p className="dar-form-note">{t('budgetHelp')}</p></details>
    </fieldset>
    {error && <div className="dar-form-error" role="alert">{error}</div>}
    {notice && <div className="dar-form-note" role="status">{notice}</div>}
    {!state.writable && <div className="dar-form-note" role="status">{t('settingsUnavailable')}</div>}
    <div className="dar-form-actions"><button type="button" className="dar-action" disabled={disabled || !dirty} onClick={() => void save()}>{busy ? t('saving') : t('save')}</button><button type="button" className="dar-link" disabled={busy} onClick={reset}>{t('reloadSettings')}</button></div>
  </div>;
}
