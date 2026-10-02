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
  const native = await load('/conversation.js'), plugin = await load('/plugin.js');
  const entries = new Map<string, ComponentType<any>>();
  const registrations: string[] = [];
  // The actual plugin decides its slot; this catches a regression back to the dock.
  plugin.apply({
    effect: (fn: () => unknown) => fn(),
    locale: { register: () => () => {}, bind: () => t },
    sidebarRightTabs: { register: () => () => {} },
    configForms: { get: () => form },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: await (await fetch('/catalog')).json() }) } },
    slots: {
      inject: (_name: string, fn: () => unknown) => fn(),
      register: (options: { name: string; inject?: () => object }, Component: ComponentType<any>) => {
        registrations.push(options.name);
        entries.set(options.name, props => <Component {...options.inject?.()} {...props} />);
        return () => {};
      },
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
  const session = { subagent: null, removed: false, running: false, promptError: null };
  const selectSession = (select: (state: typeof session) => unknown) => select(session);
  const selection = { next: { provider: 'fixture', model: 'capable' } };
  const useProjection = (key: string, select?: (value: unknown) => unknown) => {
    const value = key === 'modelSelection' ? selection : undefined;
    return select ? select(value) : value;
  };
  function DesktopComposer({ sessionId }: { sessionId: string }) {
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
        if (name === 'conversation.input.model') return <Primitives.Button size="sm" variant="ghost" className="fixture-native-chip fixture-model">capable-model<Primitives.IconChevronDownOutlineRegular size={12} /></Primitives.Button>;
        return null;
      }} />;
  }
  return DesktopComposer;
}
