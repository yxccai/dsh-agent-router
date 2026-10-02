import { useEffect, useRef, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { ModelCatalog, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types';
import { ModelPicker } from './ModelPicker.tsx';
import { modelChoices, rememberPair, routeKey, useSettings, type SettingsForm, type LoadCatalog } from './preferences.ts';

export function ChatControls({ sessionId, form, loadCatalog, current, t }: {
  sessionId: string; form: SettingsForm; loadCatalog: LoadCatalog; current?: ModelSelection | null;
} & PropsLocale<'agentRouter'>) {
  const { state, settings } = useSettings(form);
  const binding = settings?.chatBindings.find(item => item.sessionId === sessionId);
  const enabled = !!binding;
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [catalog, setCatalog] = useState<ModelCatalog>(), [catalogError, setCatalogError] = useState(false), [loading, setLoading] = useState(false);
  const [draftMain, setDraftMain] = useState(''), [draftWorker, setDraftWorker] = useState('');
  const writing = useRef(false);
  const models = settings?.models ?? [];
  const selectedRoute = (id?: string) => { const model = models.find(item => item.id === id); return model ? routeKey(model) : ''; };
  const choices = modelChoices(models, catalog, current);
  const main = enabled ? selectedRoute(binding.mainModelId) : draftMain || selectedRoute(settings?.lastMainModelId) || (current ? routeKey(current) : catalog ? routeKey(catalog.default) : '');
  const worker = enabled ? selectedRoute(binding.workerModelId) : draftWorker || selectedRoute(settings?.lastWorkerModelId);
  const writable = state.status === 'ready' && state.writable && !!settings;

  useEffect(() => { setOpen(false); setError(''); setDraftMain(''); setDraftWorker(''); }, [sessionId]);
  useEffect(() => {
    if (!(open || enabled) || catalog || catalogError) return;
    let active = true;
    setLoading(true);
    void loadCatalog().then(value => { if (active) setCatalog(value); }, () => { if (active) setCatalogError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, enabled, catalog, catalogError, loadCatalog]);

  async function save(on: boolean, mainValue = main, workerValue = worker) {
    if (!settings || !writable || writing.current) return;
    const mainChoice = choices.find(choice => choice.value === mainValue), workerChoice = choices.find(choice => choice.value === workerValue);
    if (on && (!mainChoice || !workerChoice)) { setOpen(true); return; }
    writing.current = true; setPending(true); setError('');
    try {
      const next = on ? rememberPair(settings, sessionId, mainChoice!, workerChoice!)
        : { ...settings, chatBindings: settings.chatBindings.filter(item => item.sessionId !== sessionId) };
      const fields = on ? ['models', 'lastMainModelId', 'lastWorkerModelId', 'chatBindings'] as const : ['chatBindings'] as const;
      const accepted = await form.mutate(fields.map(field => ({ op: 'set', path: [field], value: next[field] })), state.revision);
      if (!accepted) setError(t('saveFailed'));
      else { setOpen(false); setDraftMain(''); setDraftWorker(''); }
    } catch { setError(t('saveFailed')); }
    finally { writing.current = false; setPending(false); }
  }

  return <div className="dar-controls" aria-busy={pending}>
    <div className="dar-control-line">
      <button type="button" role="switch" className="dar-toggle" aria-checked={enabled} aria-label={t('delegation')}
        disabled={!writable || pending} onClick={() => { if (!enabled && open) { setOpen(false); return; } void save(!enabled); }}>
        <span className="dar-toggle-track"><span /></span><span>{t('delegation')}</span>
        <span className="dar-muted">{pending ? t('saving') : enabled ? t('on') : t('off')}</span>
      </button>
      {(enabled || open) && <div className="dar-pair">
        <ModelPicker label={t('mainModel')} value={main} choices={choices} disabled={!writable || pending} t={t}
          onChange={value => { setDraftMain(value); if (enabled) void save(true, value, worker); }} />
        <span className="dar-pair-arrow" aria-hidden="true">→</span>
        <ModelPicker label={t('workerModel')} value={worker} choices={choices} disabled={!writable || pending} t={t}
          onChange={value => { setDraftWorker(value); if (enabled) void save(true, main, value); }} />
      </div>}
      {open && !enabled && <button type="button" className="dar-action" disabled={!main || !worker || pending || !writable} onClick={() => void save(true)}>{t('enable')}</button>}
    </div>
    {error && <div className="dar-form-error" role="alert">{error}</div>}
    {state.status !== 'ready' && <div className="dar-form-note" role="status">{t(state.status === 'loading' ? 'loadingSettings' : 'settingsUnavailable')}</div>}
    {state.status === 'ready' && !writable && <div className="dar-form-note" role="status">{t('settingsUnavailable')}</div>}
    {(open || enabled) && loading && <div className="dar-form-note" role="status">{t('loadingModels')}</div>}
    {(open || enabled) && catalog && !loading && !choices.length && <div className="dar-form-note" role="status">{t('noModels')}</div>}
    {(open || enabled) && (catalogError || !!catalog?.failures.length) && <div className="dar-form-note" role="status">{t('catalogFailed')} <button type="button" className="dar-link" onClick={() => { setCatalog(undefined); setCatalogError(false); }}>{t('retry')}</button></div>}
  </div>;
}
