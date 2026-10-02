import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconBranchOutlineRegular, IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular, IconCloseOutlineRegular, MenuSurface,
  useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types';
import { ModelList, ModelPicker } from './ModelPicker.tsx';
import { modelChoices, rememberPair, routeKey, useSettings, type SettingsForm, type ModelDirectoryHandle } from './preferences.ts';

export function ChatControls({ sessionId, form, directory, current, t }: {
  sessionId: string; form: SettingsForm; directory: ModelDirectoryHandle; current?: ModelSelection | null;
} & PropsLocale<'agentRouter'>) {
  const { state, settings } = useSettings(form);
  const binding = settings?.chatBindings.find(item => item.sessionId === sessionId);
  const enabled = !!binding;
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [pane, setPane] = useState<'main' | 'worker'>();
  const catalog = useSyncExternalStore(useCallback(fn => directory.store.subscribe(fn), [directory]), useCallback(() => directory.store.getSnapshot(), [directory]));
  const [draftMain, setDraftMain] = useState(''), [draftWorker, setDraftWorker] = useState('');
  const writing = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null), panelRef = useRef<HTMLDivElement>(null), chooserRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const position = useAnchoredPosition({ open, anchorRef: rootRef, panelRef, side: 'top', gap: 8, margin: 12 });
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);
  const models = settings?.models ?? [];
  const selectedRoute = (id?: string) => { const model = models.find(item => item.id === id); return model ? routeKey(model) : ''; };
  const choices = modelChoices(models, catalog, catalog.current ?? current);
  const primary = catalog.current ?? current;
  const main = enabled ? selectedRoute(binding.mainModelId) : draftMain || selectedRoute(settings?.lastMainModelId) || (primary ? routeKey(primary) : '');
  const worker = enabled ? selectedRoute(binding.workerModelId) : draftWorker || selectedRoute(settings?.lastWorkerModelId);
  const writable = state.status === 'ready' && state.writable && !!settings;

  useEffect(() => { setOpen(false); setPane(undefined); setError(''); setDraftMain(''); setDraftWorker(''); }, [sessionId]);
  useEffect(() => { if (!open) setPane(undefined); }, [open]);
  useEffect(() => {
    if (!open) return;
    if (!pane) panelRef.current?.querySelector<HTMLButtonElement>('.dar-picker-trigger')?.focus({ preventScroll: true });
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopPropagation();
      if (pane) setPane(undefined);
      else { setOpen(false); chooserRef.current?.focus({ preventScroll: true }); }
    };
    document.addEventListener('keydown', dismiss, true);
    return () => document.removeEventListener('keydown', dismiss, true);
  }, [open, pane]);
  const reload = useCallback(() => { void directory.load().catch(() => { /* The shared native directory retains its error. */ }); }, [directory]);
  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

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
      <div className="dar-popover-heading">
        {pane && <Button variant="ghost" size="sm" className="dar-popover-close" aria-label={t('back')} onClick={() => setPane(undefined)}><IconChevronLeftOutlineRegular size={14} /></Button>}
        <span>{t(pane === 'main' ? 'mainModel' : pane === 'worker' ? 'workerModel' : 'chooseModels')}</span>
        <Button variant="ghost" size="sm" className="dar-popover-close" aria-label={t('close')}
          onClick={() => { setOpen(false); chooserRef.current?.focus({ preventScroll: true }); }}><IconCloseOutlineRegular size={14} /></Button>
      </div>
      {!pane && <div className="dar-pair">
        <ModelPicker label={t('mainModel')} value={main} choices={choices} disabled={!writable || pending} t={t}
          onOpen={() => setPane('main')} />
        <ModelPicker label={t('workerModel')} value={worker} choices={choices} disabled={!writable || pending} t={t}
          onOpen={() => setPane('worker')} />
      </div>}
      {pane && <ModelList key={pane} label={t(pane === 'main' ? 'mainModel' : 'workerModel')} value={pane === 'main' ? main : worker} choices={choices}
        disabled={!writable || pending} t={t} onChange={value => {
          if (pane === 'main') { setDraftMain(value); if (enabled) void save(true, value, worker, false); }
          else { setDraftWorker(value); if (enabled) void save(true, main, value, false); }
          setPane(undefined);
        }} />}
    {error && <div className="dar-form-error" role="alert">{error}</div>}
    {state.status !== 'ready' && <div className="dar-form-note" role="status">{t(state.status === 'loading' ? 'loadingSettings' : 'settingsUnavailable')}</div>}
    {state.status === 'ready' && !writable && <div className="dar-form-note" role="status">{t('settingsUnavailable')}</div>}
    {catalog.status === 'loading' && <div className="dar-form-note" role="status">{t('loadingModels')}</div>}
    {catalog.error && <div className="dar-form-note" role="status">{t('catalogFailed')} <button type="button" className="dar-link" onClick={reload}>{t('retry')}</button></div>}
    {!!catalog.failures.length && <div className="dar-form-note" role="status">{t('catalogPartial')}</div>}
    {pending && <div className="dar-form-note" role="status">{t('saving')}</div>}
    {!enabled && !pane && <Button variant="primary" size="sm" className="dar-enable" disabled={!main || !worker || pending || !writable} onClick={() => void save(true)}>{t('enable')}</Button>}
    </MenuSurface>, document.body)}
  </div>;
}
