import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot';
import ConfigEditor from '@deepseek-ai/dsh-config-editor';
import SettingsForms from '@deepseek-ai/dsh-settings';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import * as Router from '../src/index.ts';
import { FixtureAdapter, settings } from './harness.ts';

/** Use the real profile document, editor, Loader and live volatile settings. */
export async function settingsHarness(adapter: FixtureAdapter) {
  await mkdir('.test-output', { recursive: true });
  const home = await mkdtemp(resolve('.test-output', 'settings-'));
  const dir = join(home, 'profiles', 'test'), bundle = join(dir, 'node_modules', 'test-bundle');
  await mkdir(bundle, { recursive: true });
  initProfile(dir, ['test-bundle']);
  await writeFile(join(home, 'package.json'), '{"name":"private-test-host","private":true}');
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
    { id: 'dsh-agent-router', name: 'cordis:router', config: settings() },
  ] }]));
  await writeFile(join(home, 'cordis.yml'), '[]');
  const profile: ProfileContext = { name: 'test', dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'),
    cwd: home, home, startedBundles: ['test-bundle'], overlays: [], telemetryDisabledEnv: undefined };
  async function start() {
    return boot('router-test', join(home, 'cordis.yml'), readProfilePatches('router-test', profile), async ctx => {
      ctx.provide('profileContext', profile);
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: SettingsForms, router: Router });
      await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
      await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {}); await ctx.plugin(AgentRegistry);
      await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(SubagentRuntime, {}); await ctx.plugin(Spawn, { providerName: 'spawn' });
      ctx.llm.registerAdapter(['fixture'], adapter);
    });
  }
  let ctx: Awaited<ReturnType<typeof start>>;
  try { ctx = await start(); } catch (error) {
    if (!resolve(home).startsWith(resolve('.test-output') + sep)) throw new Error('Settings fixture escaped its output root.');
    await rm(home, { recursive: true, force: true }); throw error;
  }
  return {
    get ctx() { return ctx; }, profile,
    async createParent(id = SessionId(crypto.randomUUID())) { return ctx.agentLoop.create(id, { provider: 'fixture', model: 'capable' }); },
    async restart() { await ctx.fiber.dispose(); ctx = await start(); },
    async dispose() {
      await ctx.fiber.dispose();
      if (!resolve(home).startsWith(resolve('.test-output') + sep)) throw new Error('Settings fixture escaped its output root.');
      await rm(home, { recursive: true, force: true });
    },
  };
}
