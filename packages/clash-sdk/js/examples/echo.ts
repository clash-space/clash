/**
 * Echo — minimal example for the JS SDK. Returns the prompt back as
 * a text node. Mirrors `packages/clash-sdk/python/examples/echo_action.py`.
 *
 * Run:
 *   CLASH_API_KEY=...  CLASH_API_URL=http://localhost:3001  \
 *   CLASH_PROJECT_ID=... CLASH_RUNTIME_ID=...  \
 *   tsx packages/clash-sdk/js/examples/echo.ts
 *
 * Or after `pnpm build:package @clash/sdk` from the repository root:
 *   node --import tsx packages/clash-sdk/js/examples/echo.ts
 */

import { defineAction, run, actionResult } from '../src/index.js';

const echo = defineAction({
  id: 'echo',
  name: 'Echo',
  description: 'Returns the prompt text back as a text node',
  outputType: 'text',
  promptModalities: ['text'],
  async handler(ctx) {
    return actionResult.text(`Echo: ${ctx.prompt}`, {
      description: 'Echoed prompt text',
    });
  },
});

const wordCount = defineAction({
  id: 'word-count-js',
  name: 'Word Count (JS)',
  description: 'Counts words in the prompt — JS port of the Python example',
  outputType: 'text',
  promptModalities: ['text'],
  parameters: [
    { id: 'include_chars', label: 'Include character count', type: 'boolean', defaultValue: false },
  ],
  async handler(ctx) {
    const words = ctx.prompt.trim().split(/\s+/).filter(Boolean).length;
    let text = `Word count: ${words}`;
    if (ctx.params.include_chars) text += `\nCharacter count: ${ctx.prompt.length}`;
    return actionResult.text(text);
  },
});

await run({
  serverUrl: process.env.CLASH_SERVER_URL ?? process.env.CLASH_API_URL ?? 'ws://localhost:8789',
  projectId: requireEnv('CLASH_PROJECT_ID'),
  apiKey: requireEnv('CLASH_API_KEY'),
  runtimeId: requireEnv('CLASH_RUNTIME_ID'),
  actions: [echo, wordCount],
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ ${name} is required (see header comment)`);
    process.exit(2);
  }
  return v;
}
