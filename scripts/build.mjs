import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('lib', { recursive: true });
await build({ entryPoints: ['src/index.ts'], outdir: 'lib', bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', sourcemap: true });
const client = await build({ entryPoints: ['src/client/index.tsx'], bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'], loader: { '.css': 'text' }, minify: true, write: false });
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:"dsh-agent-router",factory:function(require){var module={exports:{}};var exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
console.log('Built Host ESM and DSH lazy-CJS client.');
