import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconBranchOutlineRegular, IconChevronDownOutlineRegular, IconCloseOutlineRegular, MenuSurface,
  useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives';
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
  const rootRef = useRef<HTMLDivElement>(null), panelRef = useRef<HTMLDivElement>(null), chooserRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const position = useAnchoredPosition({ open, anchorRef: rootRef, panelRef, side: 'top', gap: 8, margin: 12 });
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);
  const models = settings?.models ?? [];
  const selectedRoute = (id?: string) => { const model = models.find(item => item.id === id); return model ? routeKey(model) : ''; };
  const choices = modelChoices(models, catalog, current);
  const main = enabled ? selectedRoute(binding.mainModelId) : draftMain || selectedRoute(settings?.lastMainModelId) || (current ? routeKey(current) : catalog ? routeKey(catalog.default) : '');
  const worker = enabled ? selectedRoute(binding.workerModelId) : draftWorker || selectedRoute(settings?.lastWorkerModelId);
  const writable = state.status === 'ready' && state.writable && !!settings;

  useEffect(() => { setOpen(false); setError(''); setDraftMain(''); setDraftWorker(''); }, [sessionId]);
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: true });
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); chooserRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', dismiss, true);
    return () => document.removeEventListener('keydown', dismiss, true);
  }, [open]);
  useEffect(() => {
    if (!(open || enabled) || catalog || catalogError) return;
    let active = true;
    setLoading(true);
    void loadCatalog().then(value => { if (active) setCatalog(value); }, () => { if (active) setCatalogError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, enabled, catalog, catalogError, loadCatalog]);

  async function save(on: boolean, mainValue = main, workerValue = worker, close = true) {
    if (!settings || !writable || writing.current) return;
    const mainChoice = choices.find(choice => choice.value === mainValue), workerChoice = choices.find(choice => choice.value === workerValue);
    if (on && (!mainChoice || !workerChoice)) { setOpen(true); return; }
    writing.current = true; setPending(true); setError('');
    try {
      const next = on ? rememberPair(settings, sessionId, mainChoice!, workerChoice!)
        : { ...settings, chatBindings: settings.chatBindings.filter(item => item.sessionId !== sessionId) };
      const fields = on ? ['models', 'lastMainModelId', 'lastWorkerModelId', 'chatBindings'] as const : ['chatBindings'] as const;
      const accepted = await form.mutate(fields.map(field => ({ op: 'set', path: [field], value: next[field] })), state.revision);
      if (!accepted) { setError(t('saveFailed')); setOpen(true); }
      else { if (close) setOpen(false); setDraftMain(''); setDraftWorker(''); }
    } catch { setError(t('saveFailed')); setOpen(true); }
    finally { writing.current = false; setPending(false); }
  }

  return <div ref={rootRef} className="dar-controls" data-enabled={enabled} aria-busy={pending}>
    <Button variant="ghost" size="sm" role="switch" className="dar-toggle" aria-checked={enabled} aria-label={t('delegation')}
      icon={<IconBranchOutlineRegular size={14} />} disabled={!writable || pending}
      onClick={() => { void save(!enabled); }}>{t('delegation')}<span className="dar-enabled-dot" aria-hidden="true" /></Button>
    <Button ref={chooserRef} variant="ghost" size="sm" className="dar-choose" aria-label={t('chooseModels')}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => setOpen(value => !value)}><IconChevronDownOutlineRegular size={12} /></Button>
    {open && createPortal(<MenuSurface id={panelId} ref={panelRef} role="dialog" aria-label={t('chooseModels')}
      className="dar-model-popover" style={position ?? { left: 0, top: 0, visibility: 'hidden' }}>
      <div className="dar-popover-heading"><span>{t('chooseModels')}</span>
        <Button variant="ghost" size="sm" className="dar-popover-close" aria-label={t('close')}
          onClick={() => { setOpen(false); chooserRef.current?.focus({ preventScroll: true }); }}><IconCloseOutlineRegular size={14} /></Button>
      </div>
      <div className="dar-pair">
        <ModelPicker label={t('mainModel')} value={main} choices={choices} disabled={!writable || pending} t={t}
          onChange={value => { setDraftMain(value); if (enabled) void save(true, value, worker, false); }} />
        <ModelPicker label={t('workerModel')} value={worker} choices={choices} disabled={!writable || pending} t={t}
          onChange={value => { setDraftWorker(value); if (enabled) void save(true, main, value, false); }} />
      </div>
    {error && <div className="dar-form-error" role="alert">{error}</div>}
    {state.status !== 'ready' && <div className="dar-form-note" role="status">{t(state.status === 'loading' ? 'loadingSettings' : 'settingsUnavailable')}</div>}
    {state.status === 'ready' && !writable && <div className="dar-form-note" role="status">{t('settingsUnavailable')}</div>}
    {loading && <div className="dar-form-note" role="status">{t('loadingModels')}</div>}
    {catalog && !loading && !choices.length && <div className="dar-form-note" role="status">{t('noModels')}</div>}
    {(catalogError || !!catalog?.failures.length) && <div className="dar-form-note" role="status">{t('catalogFailed')} <button type="button" className="dar-link" onClick={() => { setCatalog(undefined); setCatalogError(false); }}>{t('retry')}</button></div>}
    {pending && <div className="dar-form-note" role="status">{t('saving')}</div>}
    {!enabled && <Button variant="primary" size="sm" className="dar-enable" disabled={!main || !worker || pending || !writable} onClick={() => void save(true)}>{t('enable')}</Button>}
    </MenuSurface>, document.body)}
  </div>;
}
