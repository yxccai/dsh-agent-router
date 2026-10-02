import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import * as Cordis from '@deepseek-ai/cordis';
import * as Store from '@deepseek-ai/dsh-client-store';
import * as Slots from '@deepseek-ai/dsh-client-ui-slots';
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives';
import type { ComponentType } from 'react';
import type { SettingsForm } from '../src/client/preferences.ts';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';

/** Load the published desktop code; only its service inputs use fixtures. */
export async function loadDesktop(form: SettingsForm, t: TranslateNS<'agentRouter'>) {
  const modules: Record<string, unknown> = { react: React, 'react/jsx-runtime': JSX, 'react-dom': ReactDOM,
    '@deepseek-ai/cordis': Cordis, '@deepseek-ai/dsh-client-store': Store,
    '@deepseek-ai/dsh-client-ui-slots': Slots, '@deepseek-ai/dsh-client-ui-primitives': Primitives };
  const load = async (path: string) => {
    let factory: ((require: (id: string) => unknown) => any) | undefined;
    const moduleWindow = window as unknown as { __ModuleLoader__?: unknown };
    const previous = moduleWindow.__ModuleLoader__;
    moduleWindow.__ModuleLoader__ = { load: (entry: { factory: typeof factory }) => { factory = entry.factory; } };
    try { new Function(await (await fetch(path)).text())(); }
    finally { moduleWindow.__ModuleLoader__ = previous; }
    if (!factory) throw new Error('Desktop bundle did not register.');
    return factory(id => { if (!(id in modules)) throw new Error('Missing desktop module: ' + id); return modules[id]; });
  };
  const native = await load('/conversation.js'), models = await load('/models.js'), plugin = await load('/plugin.js');
  const ctx = new Cordis.Context();
  const entries = new Map<string, ComponentType<any>>();
  const registrations: string[] = [];
  const bindings = new Map<string, { scope: Cordis.Context; session: { getSnapshot(): { blank: boolean }; projections: { faceOf(): Store.SnapshotStore<any> } } }>();
  const reloadSelection = async (id: string) => {
    const { projection } = await (await fetch('/selection?sessionId=' + encodeURIComponent(id))).json();
    bindings.get(id)?.session.projections.faceOf().set(projection);
  };
  const bindingFor = (id: string) => {
    let binding = bindings.get(id);
    if (!binding) {
      const projected = Store.createSnapshotStore(undefined);
      binding = { scope: ctx.extend(), session: { getSnapshot: () => ({ blank: true }), projections: { faceOf: () => projected } } };
      bindings.set(id, binding);
      void reloadSelection(id);
    }
    return binding;
  };
  const listeners = new Map<string, Set<() => void>>();
  const publish = (event: string) => { for (const fn of listeners.get(event) ?? []) fn(); };
  let catalogCalls = 0;
  const sessionRemote = {
    modelCatalog: async () => {
      catalogCalls++;
      const response = await fetch('/catalog'), value = await response.json();
      return response.ok ? { ok: true, value } : { ok: false, error: value };
    },
    selectModel: async (selection: { sessionId: string; provider: string; model: string }) => {
      const result = await (await fetch('/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection) })).json();
      if (result.ok) {
        bindingFor(selection.sessionId).session.projections.faceOf().set(result.projection);
        publish('settings/document-updated');
      }
      return result;
    },
  };
  // Services are provided by a sibling plugin, as in the real desktop. Root-provided
  // test objects would conceal undeclared dependency access in the consuming plugin.
  await ctx.plugin({ apply(scope: Cordis.Context) {
    scope.provide('sessions', { scope: (id: string) => bindingFor(id).scope, binding: bindingFor, subagentAddress: () => undefined } as never);
    scope.provide('remote', { session: sessionRemote, $on: (event: string, fn: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn);
      return () => listeners.get(event)!.delete(fn);
    } } as never);
    scope.provide('remote.session', sessionRemote);
    scope.provide('locale', { register: () => () => {}, bind: () => t } as never);
    scope.provide('sidebarRightTabs', { register: () => () => {} } as never);
    scope.provide('configForms', { get: () => form } as never);
    scope.provide('slots', {
      inject: (_name: string, fn: () => unknown) => fn(),
      register: (options: { name: string; inject?: (sessionId: string) => object }, Component: ComponentType<any>) => {
        registrations.push(options.name);
        entries.set(options.name, props => <Component {...options.inject?.(props.sessionId)} {...props} />);
        return () => {};
      },
    } as never);
  } });
  await ctx.plugin(models.ModelDirectoryResolver);
  await ctx.plugin(plugin);
  Object.assign(window, {
    fixtureDisposeClient: () => ctx.fiber.dispose(),
    fixtureCatalogCalls: () => catalogCalls,
    fixtureCatalogMode: async (mode: string) => {
      await fetch('/catalog-mode', { method: 'POST', body: mode }); publish('settings/document-updated');
    },
    fixtureResetConnection: async () => {
      ctx.emit('connection/reset');
      await Promise.all([...bindings.keys()].map(reloadSelection));
    },
    fixturePrompt: async (sessionId: string) => {
      const result = await (await fetch('/prompt', { method: 'POST' })).json();
      bindingFor(sessionId).session.projections.faceOf().set(result.projection);
      return result.requests;
    },
  });
  Object.assign(window, { fixtureSlots: registrations, fixtureNativeClasses: native.__fixtureCSS });
  const locale = native.__fixtureLocales.zh as Record<string, string>;
  const translate = (key: string, vars?: Record<string, string>) => {
    let text = locale[key] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll('{' + name + '}', value);
    return text;
  };
  const InputBar = native.__fixtureInputBar as ComponentType<any>;
  const ModelSelect = models.__fixtureModelSelect as ComponentType<any>;
  const modelLocale = models.__fixtureLocales.zh as Record<string, string>;
  const modelTranslate = (key: string, vars?: Record<string, string>) => {
    let text = modelLocale[key] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll('{' + name + '}', value);
    return text;
  };
  const session = { subagent: null, removed: false, running: false, promptError: null };
  const selectSession = (select: (state: typeof session) => unknown) => select(session);
  function DesktopComposer({ sessionId }: { sessionId: string }) {
    const useProjection = (key: string, select?: (value: unknown) => unknown) => {
      const store = bindingFor(sessionId).session.projections.faceOf();
      const projected = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
      const value = key === 'modelSelection' ? projected : undefined;
      return select ? select(value) : value;
    };
    return <InputBar sessionId={sessionId} variant="composer" useSession={selectSession} useProjection={useProjection}
      keyboard={{ editor: null, caretSpan: () => ({ start: 0, end: 0 }), submit: () => {}, bindFilePicker: () => () => {} }} inputActions={{}}
      useInput={(select: (value: unknown) => unknown) => select({ draft: '', phase: 'plain', attachmentIds: [] })}
      useNotices={() => undefined} useBusyEnter={() => 'queue'} useFileUploads={() => ({})}
      useMenuLauncher={() => false} useStopShortcut={() => []} t={translate}
      renderSlot={(name: string) => {
        const Component = entries.get(name);
        if (name === 'conversation.composer.dock') return <><div className="fixture-stats" aria-label="调用统计">
          <span>◴ 2 轮 2 步 · 24 tok/s</span><span>10.4K tok · 缓存命中 72%</span></div>
          {Component && <Component key={sessionId} sessionId={sessionId} useSession={selectSession} useProjection={useProjection} t={t} />}</>;
        if (Component) return <Component key={sessionId} sessionId={sessionId} useSession={selectSession} useProjection={useProjection} t={t} />;
        if (name === 'conversation.input.permission') return <Primitives.Button size="sm" variant="ghost" className="fixture-native-chip"
          icon={<Primitives.PermissionIconWorkspaceWriteRegular size={14} />}>工作区内修改<Primitives.IconChevronDownOutlineRegular size={12} /></Primitives.Button>;
        if (name === 'conversation.input.model') {
          const directory = ctx.modelDirectories.directoryFor(sessionId as never);
          return <div className="fixture-model"><ModelSelect locked={false} available directory={directory.store}
            load={() => { void directory.load().catch(() => {}); }} select={(selection: never) => directory.select(selection)} t={modelTranslate} /></div>;
        }
        return null;
      }} />;
  }
  return DesktopComposer;
}
