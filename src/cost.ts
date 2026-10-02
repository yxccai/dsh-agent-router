import type { TokenUsage } from '@deepseek-ai/dsh-llm';
import type { Model } from './config.ts';

/** Price DSH's disjoint buckets without charging reasoning tokens twice. */
export function costOf(usage: TokenUsage | undefined, model: Model | undefined): number | null {
  if (!usage || !model) return null;
  const buckets = [
    [usage.inputTokens, model.inputPrice], [usage.outputTokens, model.outputPrice],
    [usage.cacheReadTokens ?? 0, model.cacheReadPrice], [usage.cacheWriteTokens ?? 0, model.cacheWritePrice],
  ];
  if (buckets.some(([tokens, price]) => !Number.isFinite(tokens) || tokens < 0 || (tokens > 0 && price < 0))) return null;
  return buckets.reduce((sum, [tokens, price]) => sum + (tokens === 0 ? 0 : tokens * price), 0) / 1_000_000;
}

/** Atomic process-local reservations include in-flight requests and unknown settlements. */
export class Budget {
  private readonly accounts = new Map<string, { spent: number; held: number; calls: number }>();
  has(root: string) { return this.accounts.has(root); }
  reserve(root: string, amount: number, limit: number, reviewReserve: number, worker: boolean, baseline = 0) {
    if (!Number.isFinite(amount) || amount < 0) throw new Error('A monetary budget requires prices for every requested model.');
    const account = this.accounts.get(root) ?? { spent: baseline, held: 0, calls: 0 };
    this.accounts.set(root, account);
    const ceiling = limit === 0 ? Infinity : limit - (worker ? reviewReserve : 0);
    if (account.spent + account.held + amount > ceiling) throw new Error('Agent Router budget reached. Existing results are preserved.');
    account.held += amount;
    account.calls++;
    let settled = false;
    return (actual: number | null) => {
      if (settled) return;
      settled = true;
      if (actual !== null) { account.held = Math.max(0, account.held - amount); account.spent += actual; }
    };
  }
  snapshot(root: string) { return { ...(this.accounts.get(root) ?? { spent: 0, held: 0, calls: 0 }) }; }
}

/** Reject excess work immediately; cancellation never waits in an admission queue. */
export class Capacity {
  private active = 0;
  enter(limit: number): () => void {
    if (this.active >= limit) throw new Error('Agent Router is at capacity. Wait for a delegated task to finish.');
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}
