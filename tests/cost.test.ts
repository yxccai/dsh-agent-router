import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Budget, Capacity, costOf } from '../src/cost.ts';
import { settings } from './harness.ts';

test('pricing uses disjoint cache buckets and does not double-charge reasoning', () => {
  const model = settings().models[0];
  assert.equal(costOf({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 5, reasoningTokens: 10 }, model), 0.000153);
  assert.equal(costOf({ inputTokens: 100, outputTokens: 20 }, { ...model, cacheReadPrice: -1 }), 0.00014);
  assert.equal(costOf({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 1 }, { ...model, cacheReadPrice: -1 }), null);
  assert.equal(costOf(undefined, model), null);
  assert.equal(costOf({ inputTokens: -1, outputTokens: 1 }, model), null);
});

test('overlapping reservations include in-flight requests and protect review funds', () => {
  const budget = new Budget();
  const first = budget.reserve('root', 0.4, 1, 0.2, true);
  const second = budget.reserve('root', 0.3, 1, 0.2, true);
  assert.throws(() => budget.reserve('root', 0.2, 1, 0.2, true), /budget reached/);
  first(0.1); first(0.5);
  second(null);
  assert.equal(budget.snapshot('root').spent, 0.1);
  assert.equal(budget.snapshot('root').calls, 2);
  assert.ok(Math.abs(budget.snapshot('root').held - 0.3) < 1e-12);
  const main = budget.reserve('root', 0.5, 1, 0.2, false);
  main(0.2);
  assert.ok(Math.abs(budget.snapshot('root').held - 0.3) < 1e-12);
});

test('capacity is released exactly once', () => {
  const capacity = new Capacity();
  const release = capacity.enter(1);
  assert.throws(() => capacity.enter(1), /capacity/);
  release(); release();
  const next = capacity.enter(1);
  assert.throws(() => capacity.enter(1), /capacity/);
  next();
});
