import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Graph } from '../src/client/Graph.tsx';
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
createRoot(document.getElementById('root')!).render(<Demo />);
