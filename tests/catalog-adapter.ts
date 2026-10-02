import { FixtureAdapter, textResponse } from './harness.ts';

/** Adapter boundary for the real Host catalog builder, including independent providers. */
export class CatalogAdapter extends FixtureAdapter {
  extra = false;
  failExternal = false;
  constructor() { super(() => textResponse('fixture')); }
  providerInfo(provider: string) { return { id: provider, name: provider === 'fixture' ? 'Fixture provider' : 'External API' }; }
  async listModels(provider: string) {
    if (provider === 'external' && this.failExternal) throw new Error('Fixture provider unavailable');
    const models = provider === 'fixture'
      ? [{ id: 'capable', name: 'Capable Model' }, { id: 'economy', name: 'Economy Model' }, { id: 'judge', name: 'Review Model' },
        ...this.extra ? [{ id: 'new-model', name: 'Newly Added Model' }] : []]
      : [{ id: 'capable', name: 'External Capable' }, { id: 'flash', name: 'External Flash' }, { id: 'review', name: 'External Review' }];
    return models.map(model => ({ provider, ...model }));
  }
}
