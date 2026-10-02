import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';

/** The DOM is absent in this service test; dependency access remains real Cordis. */
async function loadClient(path: string) {
  let factory: (require: (id: string) => object) => { inject: string[]; apply(ctx: Context): void };
  const document = { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } };
  runInNewContext(await readFile(path, 'utf8'), { document, window: { __ModuleLoader__: { load: (entry: { factory: typeof factory }) => { factory = entry.factory; } } } });
  return factory!(id => { assert.ok(['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'].includes(id)); return {}; });
}

test('shipping client resolves the same native model directory under Cordis dependency enforcement', async () => {
  const ctx = new Context(), client = await loadClient('lib/client.js');
  const handle = { store: {}, load: async () => ({}) }, calls: SessionId[] = [];
  let entry: { inject(sessionId: SessionId): { directory: typeof handle } } | undefined;
  const remoteReads: string[] = [];
  try {
    await ctx.plugin({ apply(scope: Context) {
      scope.provide('remote', new Proxy({}, { get: (_target, key) => { remoteReads.push(String(key)); throw new Error('Plugin must use the native model directory.'); } }) as never);
      scope.provide('sessions', {} as never);
      scope.provide('locale', { register: () => () => {}, bind: () => () => '' } as never);
      scope.provide('sidebarRightTabs', { register: () => () => {} } as never);
      scope.provide('configForms', { get: () => ({}) } as never);
      scope.provide('modelDirectories', { directoryFor: (sessionId: SessionId) => { calls.push(sessionId); return handle; } } as never);
      scope.provide('slots', {
        inject: (_name: string, callback: () => unknown) => callback(),
        register: (options: { name: string } & NonNullable<typeof entry>) => { if (options.name === 'conversation.input.left') entry = options; return () => {}; },
      } as never);
    } });
    await ctx.plugin(client);
    assert.ok(entry);
    const id = 'native-directory-session' as SessionId;
    assert.equal(entry.inject(id).directory, handle);
    assert.deepEqual(calls, [id]);
    assert.deepEqual(remoteReads, []);
  } finally { await ctx.fiber.dispose(); }
});

test('undeclared root remote access reproduces the 0.2.1 catalog failure in a real plugin scope', async () => {
  const ctx = new Context();
  let load: (() => Promise<unknown>) | undefined;
  try {
    await ctx.plugin({ apply(scope: Context) {
      scope.provide('remote', { session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } } as never);
      scope.provide('remote.session', {});
    } });
    await ctx.plugin({ inject: ['remote.session'], apply(scope: Context) { load = () => scope.remote.session.modelCatalog(); } });
    assert.ok(load);
    assert.throws(load, /cannot get property "remote" without inject/);
  } finally { await ctx.fiber.dispose(); }
});
