/**
 * JS echo example — runnable directly with `node` against the built SDK.
 * This is what marketplace install would copy into ~/.clash/actions/<id>/.
 *
 * Run standalone (dev):
 *   CLASH_API_KEY=... CLASH_API_URL=http://localhost:3001 \
 *   CLASH_PROJECT_ID=... CLASH_RUNTIME_ID=... \
 *   node packages/clash-sdk/js/examples/echo.mjs
 */
import { defineAction, run, actionResult } from '../dist/index.js';

const echo = defineAction({
  id: 'echo-js',
  name: 'Echo (JS)',
  description: 'JS-SDK echo — returns the prompt back as a text node',
  outputType: 'text',
  promptModalities: ['text'],
  async handler(ctx) {
    return actionResult.text(`Echo (JS): ${ctx.prompt}`, {
      description: 'Echoed prompt text from the JS SDK',
    });
  },
});

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ ${name} is required`);
    process.exit(2);
  }
  return v;
}

await run({
  serverUrl: process.env.CLASH_SERVER_URL ?? process.env.CLASH_API_URL ?? 'ws://localhost:8789',
  projectId: requireEnv('CLASH_PROJECT_ID'),
  apiKey: requireEnv('CLASH_API_KEY'),
  runtimeId: requireEnv('CLASH_RUNTIME_ID'),
  actions: [echo],
});
