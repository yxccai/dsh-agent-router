import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Graph } from '../src/client/Graph.tsx';
import { loadDesktop } from './native-desktop.tsx';
import type { ComponentType } from 'react';
import { SettingsPage } from '../src/client/SettingsPage.tsx';
import { configSchema, type Settings } from '../src/settings-schema.ts';
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client';
import { en, zh, type Key } from '../src/client/locales.ts';
import { viewSchema } from '../src/contracts.ts';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import css from '../src/client/style.css';

// Component fixtures describe illustrative agents, not live paid API activity.
const agents = [
  { sessionId: 'root', parentId: null, label: '主代理', model: 'capable-model', state: 'waiting' },
  { sessionId: 'sources', parentId: 'root', label: '资料整理', model: 'economy-model', state: 'completed' },
  { sessionId: 'draft', parentId: 'root', label: '初稿生成', model: 'economy-model', state: 'running' },
  { sessionId: 'check', parentId: 'root', label: '结果核验', model: 'review-model', state: 'created' },
].map((row, index) => viewSchema.parse({ ...row, provider: 'configured-provider', currency: 'USD',
  calls: index === 1 ? [{ id: 'sources:1', provider: 'configured-provider', model: row.model, state: 'completed', startedAt: 1, endedAt: 2, cost: null }] : [],
  knownCost: 0, unknownCalls: index === 1 ? 1 : 0, callCount: index === 1 ? 1 : 0 }));
const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
const language = new URL(location.href).searchParams.get('language') === 'en' ? en : zh;
const t: TranslateNS<'agentRouter'> = (key: Key, vars?: Record<string, string>) => {
  let value = language[key];
  for (const [name, text] of Object.entries(vars ?? {})) value = value.replace('{' + name + '}', text);
  return value;
};
function Demo() {
  const [rows, setRows] = useState(agents);
  const [incomplete, setIncomplete] = useState(false);
  Object.assign(window, {
    updateFixture: () => setRows(rows.map(row => ({ ...row, state: 'completed' }))),
    failFixture: () => setIncomplete(true),
    emptyFixture: () => setRows([]),
  });
  return <Graph agents={rows} t={t} incomplete={incomplete} onRetry={() => setIncomplete(false)} />;
}

/** Browser-to-Host test transport; persistence and acceptance use the real DSH editor. */
class FixtureForm implements ConfigForm<Settings> {
  private state: ConfigFormSnapshot<Settings> = { status: 'loading', value: undefined, base: {}, user: {}, revision: undefined, writable: false, mode: 'host' };
  private listeners = new Set<() => void>();
  getSnapshot() { return this.state; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  accept(snapshot: ConfigFormSnapshot<Settings>) {
    this.state = { ...snapshot, value: snapshot.value ? configSchema.parse(snapshot.value) : undefined };
    for (const listener of this.listeners) listener();
  }
  async reload() {
    const data = await (await fetch('/prefs')).json(); this.accept(data.state); return data.sessionId as string;
  }
  async mutate(ops: readonly SettingsPathOpView[], expectedRevision?: number) {
    const data = await (await fetch('/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops, expectedRevision }) })).json();
    this.accept(data.state); return data.accepted as boolean;
  }
  set(field: string, value: unknown) { return this.mutate([{ op: 'set', path: [field], value: value as Extract<SettingsPathOpView, { op: 'set' }>['value'] }]); }
  unset(field: string) { return this.mutate([{ op: 'unset', path: [field] }]); }
}
const form = new FixtureForm();
function ConversationDemo({ initialSessionId, Composer }: { initialSessionId: string; Composer: ComponentType<{ sessionId: string }> }) {
  const [sessionId, setSessionId] = useState(initialSessionId), [generation, setGeneration] = useState(0), [page, setPage] = useState(false);
  Object.assign(window, {
    fixtureNewChat: async () => { await fetch('/chat', { method: 'POST' }); setSessionId(await form.reload()); },
    fixtureRejectNext: () => fetch('/reject', { method: 'POST' }),
    fixtureRemount: async () => { await form.reload(); setGeneration(value => value + 1); },
    fixtureRestart: async () => {
      await fetch('/restart', { method: 'POST' }); await form.reload();
      await (window as unknown as { fixtureResetConnection(): Promise<void> }).fixtureResetConnection();
      setGeneration(value => value + 1);
    },
    fixtureShowSettings: () => setPage(true),
  });
  if (page) return <SettingsPage form={form} t={t} />;
  return <div className="fixture-conversation"><Composer key={`${sessionId}:${generation}`} sessionId={sessionId} /></div>;
}
const root = createRoot(document.getElementById('root')!);
if (new URL(location.href).searchParams.get('view') === 'controls') {
  document.querySelector('header')!.textContent = 'DSH 原生聊天框 · 插件布局测试';
  void Promise.all([form.reload(), loadDesktop(form, t)]).then(([sessionId, Composer]) => root.render(<ConversationDemo initialSessionId={sessionId} Composer={Composer} />));
} else root.render(<Demo />);
