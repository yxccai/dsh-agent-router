import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configSchema } from '../src/config.ts';
import { settings } from './harness.ts';

test('invalid role references and ambiguous route prices fail explicitly', () => {
  assert.throws(() => settings({ roles: [{ name: 'x', modelId: 'missing', fallbackModelId: '', verifierModelId: '', toolAllow: [] }] }), /configured model/);
  const model = settings().models[0];
  assert.throws(() => settings({ models: [model, { ...model, id: 'other' }] }), /one price definition/);
  assert.throws(() => configSchema.parse({ sessionBudget: 1, finalReviewReserve: 1 }), /smaller/);
  assert.equal(configSchema.parse({}).sessionBudget, 0);
});
