import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ModelSelection, SessionSelectModelRequest } from '@deepseek-ai/dsh-api-session-controller/types';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';

// The pinned package ships these owners without public subpath exports. Load the
// published implementations so selections append real events and route real steps.
const root = dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-api-session-controller/package.json'));
const { ApiSessionAgentController } = await import(pathToFileURL(join(root, 'lib/types/agent.js')).href);
const { SessionCommandController } = await import(pathToFileURL(join(root, 'lib/types/commands.js')).href);
const { installModelSelectionProjection } = await import(pathToFileURL(join(root, 'lib/types/model-selection-projection.js')).href);

export async function nativeModelHost(ctx: Context, cwd: string, initial: ModelSelection = { provider: 'fixture', model: 'capable' }) {
  let defaultSelection = { ...initial };
  await ctx.plugin(TypertRegistry);
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ ...defaultSelection }),
    saveSelection: async (selection: ModelSelection) => { defaultSelection = { ...selection }; },
  } as never);
  installModelSelectionProjection(ctx);
  const agents = new ApiSessionAgentController(ctx), commands = new SessionCommandController(ctx, agents, cwd);
  return {
    get defaultSelection() { return { ...defaultSelection }; },
    attach(agent: Agent) { agents.selectionFor(agent); },
    select(request: SessionSelectModelRequest): Promise<unknown> { return commands.selectModel(request); },
    snapshot(agent: Agent) { return ctx.sessionProjections.snapshot(agent.session).values.modelSelection!; },
  };
}
