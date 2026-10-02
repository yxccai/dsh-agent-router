import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadOverlayPatches, composeEntries, bundlePatchPaths } from '@deepseek-ai/dsh-app-boot';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import SessionStore from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';

const archive = resolve(process.argv[2] ?? 'artifacts/dsh-agent-router-0.2.0.tgz');
await mkdir('.test-output', { recursive: true });
const directory = await mkdtemp(resolve('.test-output', 'package-'));
const ctx = new Context();
try {
  const names = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(names.every(name => name.startsWith('package/') && !name.split('/').includes('..')));
  assert.ok(names.every(name => !name.includes('.tools') && !name.includes('.env') && !name.includes('node_modules')));
  execFileSync('tar', ['-xf', archive, '-C', directory]);
  const root = join(directory, 'package');
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const rows = composeEntries(bundlePatchPaths(root, manifest.dsh.bundle).map(file => loadOverlayPatches('dsh', file)));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, manifest.name);
  const plugin = await import(pathToFileURL(join(root, 'lib/index.js')).href);
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime, {});
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(SubagentRuntime, {});
  const fiber = await ctx.plugin(plugin, rows[0].config);
  assert.equal(typeof ctx.tools.get('team_roles')?.execute, 'function');
  assert.equal(typeof ctx.tools.get('team_delegate')?.execute, 'function');
  await fiber.dispose();
  assert.equal(ctx.tools.get('team_delegate'), undefined);
  console.log('Packed archive: native DSH patch parsed; extracted Host mounted and disposed; source archive excludes credentials and development caches.');
} finally {
  await ctx.fiber.dispose();
  if (!resolve(directory).startsWith(resolve('.test-output') + sep)) throw new Error('Package cleanup escaped its private output root.');
  await rm(directory, { recursive: true, force: true });
}
