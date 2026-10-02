import type { Context } from '@deepseek-ai/cordis';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ISessions, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/remote';
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { viewSchema, type AgentView } from '../contracts.ts';
import { Graph } from './Graph.tsx';
import { ChatControls } from './ChatControls.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import type { SettingsForm, LoadCatalog } from './preferences.ts';
import { en, zh, NS } from './locales.ts';
import css from './style.css';
export const inject = ['sessions', 'slots', 'locale', 'sidebarRightTabs', 'configForms', 'remote.session'];
const ID = 'dsh-agent-router';
type BodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<typeof NS> & { sessions: ISessions };
type ControlsProps = PropsRuntime<'conversation.input.left'> & PropsLocale<typeof NS> & { settingsForm: SettingsForm; loadCatalog: LoadCatalog };
function Controls({ sessionId, useSession, useProjection, settingsForm, loadCatalog, t }: ControlsProps) {
  const selection = useProjection('modelSelection');
  const unavailable = useSession(session => !!session.subagent || session.removed);
  if (unavailable) return null;
  return <ChatControls key={sessionId} sessionId={sessionId} form={settingsForm} loadCatalog={loadCatalog} current={selection?.next} t={t} />;
}
function Page({ view, settingsForm, t }: PropsRuntime<'plugins.bundle.config'> & PropsLocale<typeof NS> & { settingsForm: SettingsForm }) {
  return view === 'summary' ? <span>{t('configSummary')}</span> : <SettingsPage form={settingsForm} t={t} />;
}

function Body({ sessionId, sessions, t }: BodyProps) {
  const snapshot = useSyncExternalStore<SessionListState>(sessions.list.subscribe, sessions.list.getSnapshot);
  const requested = useRef(new Set<string>());
  const data = useMemo(() => {
    const agents: AgentView[] = [], pending: SessionId[] = [];
    let incomplete = false;
    const seen = new Set<string>();
    function visit(id: SessionId, parentId: string | null, label?: string) {
      if (seen.has(id)) return;
      seen.add(id);
      const observation = snapshot.projectionsBySession[id];
      if (observation?.state === 'error') incomplete = true;
      const values = observation?.values ?? snapshot.byId[id]?.projectionValues;
      const parsed = viewSchema.safeParse(values?.agentRouter);
      if (parsed.success) agents.push({ ...parsed.data, parentId, label: label || parsed.data.label });
      else { pending.push(id); if (observation?.state === 'ready') incomplete = true; }
      for (const child of values?.subagentCatalog ?? []) visit(child.id, id, child.label);
    }
    visit(sessionId, null);
    return { agents, pending, incomplete };
  }, [snapshot, sessionId]);
  useEffect(() => { requested.current.clear(); }, [sessionId]);
  useEffect(() => {
    for (const id of data.pending) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      void sessions.refreshProjections(id).catch(() => { /* The object layer retains the query error. */ });
    }
  }, [data.pending, sessions]);
  return <Graph agents={data.agents} t={t} incomplete={data.incomplete} onRetry={() => {
    for (const id of [sessionId, ...data.pending]) void sessions.refreshProjections(id).catch(() => { /* Error remains visible in the object layer. */ });
  }} />;
}

/** Mount one native right-sidebar tab; no new window or HTTP endpoint is required. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style'); style.dataset.plugin = ID; style.textContent = css;
    document.head.appendChild(style); return () => style.remove();
  });
  ctx.effect(() => ctx.locale.register(NS, { en, zh }));
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID, kind: 'agent-router', title: () => t('title'),
    guide: [{ id: 'agent-router', order: 35, title: () => t('title'), description: () => t('description'), icon: IconChevronRightOutlineRegular }],
  }));
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: ID, locale: NS, inject: () => ({ sessions: ctx.sessions }),
  }, Body));
  const settingsForm = ctx.configForms.get<import('../settings-schema.ts').Settings>(ID);
  const loadCatalog: LoadCatalog = async () => {
    const result = await ctx.remote.session.modelCatalog();
    if (!result.ok) throw new Error('The model catalog could not be loaded.');
    return result.value;
  };
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: ID, locale: NS, order: 35, registrant: ID,
    inject: () => ({ settingsForm, loadCatalog }),
  }, Controls));
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: ID, locale: NS, inject: () => ({ settingsForm }),
  }, Page));
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config', key: `${ID}#${ID}`, locale: NS, inject: () => ({ settingsForm }),
  }, Page));
}
