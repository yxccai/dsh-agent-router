import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { AgentView } from '../contracts.ts';
import { edgePath, layoutTree } from './layout.ts';
import { NS } from './locales.ts';

export interface GraphProps { agents: AgentView[]; t: TranslateNS<typeof NS>; incomplete?: boolean; onRetry?: () => void }

/** Render agent identity as boxes; per-request and billing details remain collapsed. */
export function Graph({ agents, t, incomplete, onRetry }: GraphProps): ReactNode {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [selected, setSelected] = useState<string | null>(null);
  const [requests, setRequests] = useState(false);
  const marker = useId().replace(/:/g, '');
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element); setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!agents.some(agent => agent.sessionId === selected)) setSelected(null); }, [agents, selected]);
  const layout = useMemo(() => layoutTree(agents, width), [agents, width]);
  const positions = new Map(layout.nodes.map(node => [node.id, node]));
  const current = agents.find(agent => agent.sessionId === selected);
  function close() {
    const id = selected; setSelected(null); setRequests(false);
    queueMicrotask(() => container.current?.querySelector<HTMLButtonElement>(`[data-agent-id="${CSS.escape(id ?? '')}"]`)?.focus());
  }
  return <div className="dar-panel" onKeyDown={event => { if (event.key === 'Escape' && selected) close(); }}>
    {incomplete && <div className="dar-notice" role="status">{t('incomplete')} <button type="button" onClick={onRetry}>{t('retry')}</button></div>}
    <div className="dar-viewport" ref={container}>
      {agents.length === 0 ? <div className="dar-empty">{t('empty')}</div> : <div className="dar-canvas" style={{ width: layout.width, height: layout.height }} role="group" aria-label={t('title')}>
        <svg className="dar-links" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
          <defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L7 4L1 7Z" className="dar-arrow" /></marker></defs>
          {layout.nodes.map(node => {
            const parent = node.parentId ? positions.get(node.parentId) : undefined;
            return parent ? <path key={node.id} d={edgePath(parent, node)} className={`dar-edge${selected === node.id ? ' dar-active-edge' : ''}`} markerEnd={`url(#${marker})`} /> : null;
          })}
        </svg>
        {agents.map(agent => {
          const position = positions.get(agent.sessionId);
          if (!position) return null;
          const name = agent.label || (agent.parentId ? t('created') : t('main'));
          return <button key={agent.sessionId} type="button" className={`dar-node${agent.parentId ? '' : ' dar-root'}`}
            style={{ left: position.x - position.width / 2, top: position.y, width: position.width }}
            aria-label={`${name} · ${agent.model || t('unknown')} · ${t(agent.state)}`} aria-pressed={selected === agent.sessionId}
            data-agent-id={agent.sessionId} data-state={agent.state}
            onClick={() => { setSelected(selected === agent.sessionId ? null : agent.sessionId); setRequests(false); }}>
            <span className="dar-name">{name}</span><span className="dar-model">{agent.model || t('unknown')}</span>
            <span className="dar-state"><span className="dar-dot" aria-hidden="true" />{t(agent.state)}</span>
          </button>;
        })}
      </div>}
    </div>
    {agents.length > 1 && <div className="dar-legend">{t('legend')}</div>}
    {current && <section className="dar-inspector" aria-live="polite">
      <div className="dar-inspector-heading"><span>{current.label || t('main')}</span><button type="button" onClick={() => setRequests(!requests)} aria-expanded={requests}>{t('calls')} · {current.callCount}</button><button type="button" onClick={close}>{t('close')}</button></div>
      <dl><dt>{t('model')}</dt><dd>{current.model || t('unknown')}</dd><dt>{t('provider')}</dt><dd>{current.provider || t('unknown')}</dd><dt>{t('cost')}</dt><dd>{current.unknownCalls ? `${current.knownCost.toFixed(6)} ${current.currency} · ${t('partial')}` : `${current.knownCost.toFixed(6)} ${current.currency}`}</dd></dl>
      {requests && <div className="dar-request-list">
        {current.callCount > current.calls.length && <div className="dar-muted">{t('truncated', { count: String(current.calls.length) })}</div>}
        {current.calls.length === 0 && <div className="dar-muted">{t('noCalls')}</div>}
        {current.calls.map(call => <div key={call.id} className="dar-request"><span>{call.model}</span><span>{t(call.state)}</span><span>{call.cost === null ? t('unknown') : `${call.cost.toFixed(6)} ${current.currency}`}</span></div>)}
      </div>}
    </section>}
  </div>;
}
