import test from "node:test";
import assert from "node:assert/strict";
import { createGeneratorClient, GeneratorHttpError } from "./generator-client";

function recorder(response: Response = Response.json({ ok: true })) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  return { calls, request: async (path: string, init?: RequestInit) => { calls.push({ path, init }); return response.clone(); } };
}

test("native Generator client maps operations to exact v1 routes", async () => {
  const r = recorder();
  const client = createGeneratorClient(r.request);
  await client.getDefinition("plugin/a", "definition");
  await client.advanceGenerator("project", "generator", { expectedHeadRevisionId: "r1" });
  await client.submitActionRun("project", "generator", "render", { actionRunId: "run" });
  await client.getActionRun("project", "run");
  await client.getOutputCommit("project", "run", "asset");
  assert.deepEqual(r.calls.map((c) => c.path), [
    "/api/v1/generator-definitions/plugin%2Fa/definition",
    "/api/v1/projects/project/generators/generator/revisions",
    "/api/v1/projects/project/generators/generator/actions/render/runs",
    "/api/v1/projects/project/generator-runs/run",
    "/api/v1/projects/project/generator-runs/run/outputs/asset",
  ]);
  assert.equal(r.calls[1]?.init?.body, '{"expectedHeadRevisionId":"r1"}');
});

test("native Generator client retains structured API errors for agent recovery", async () => {
  const client = createGeneratorClient(async () => Response.json({ error: "stale", code: "STALE" }, { status: 409 }));
  await assert.rejects(client.getGenerator("p", "g"), (error: unknown) => error instanceof GeneratorHttpError && error.status === 409 && (error.body as any).code === "STALE");
});
