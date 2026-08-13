import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createProjectHostClient,
  publicProjectHostValue,
  projectHostCommandUrl,
  resolveProjectHostContext,
  sendProjectHostCommand,
} from "./project-host-client.js";

describe("project host client", () => {
  it("projects Host responses without exposing private concurrency evidence", () => {
    expect(publicProjectHostValue({
      updated: true,
      version: "private-top-level-version",
      versions: { "node-1": "private-list-receipt" },
      readToken: "private-read-token",
      receipt: "private-receipt",
      node: { id: "node-1", version: "semantic-node-version" },
      mutation: {
        accepted: true,
        expectedReadToken: "private-expected",
        beforeReadToken: "private-before",
        afterReadToken: "private-after",
      },
      replaceResult: {
        nodeId: "node-2",
        version: "private-replace-version",
      },
    })).toEqual({
      updated: true,
      node: { id: "node-1", version: "semantic-node-version" },
      mutation: { accepted: true },
      replaceResult: { nodeId: "node-2" },
    });
  });

  it("addresses the project-scoped neutral command route", () => {
    expect(projectHostCommandUrl("http://127.0.0.1:8789/", "project/one"))
      .toBe("http://127.0.0.1:8789/api/v1/projects/project%2Fone/host-command");
  });

  it("posts typed commands without invoking a CLI process", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ nodes: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const result = await sendProjectHostCommand({
      endpoint: "http://127.0.0.1:8789",
      projectId: "p1",
      command: { action: "list", canvasId: "main" },
      token: "local-token",
      fetch: request,
    });
    expect(result).toEqual({ nodes: [] });
    expect(request).toHaveBeenCalledOnce();
    const [, init] = request.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer local-token",
    });
  });

  it("resolves a parent workspace marker and sends the command directly to local-api", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-project-host-client-"));
    const workspace = join(root, "workspace");
    const nested = join(workspace, "shots", "opening");
    await mkdir(join(workspace, ".clash"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(workspace, ".clash", "project.toml"),
      [
        "schema_version = 1",
        'project_id = "project-marker"',
        'workspace_id = "managed:workspace"',
        'store = "managed"',
        "",
      ].join("\n"),
      "utf8",
    );
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const client = createProjectHostClient({
      endpoint: "http://127.0.0.1:49321/",
      env: {},
      fetch: async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response(JSON.stringify({ nodes: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await client.request({
      cwd: nested,
      command: { action: "list", canvasId: "main" },
    });

    expect(result).toEqual({
      projectId: "project-marker",
      workspaceRoot: workspace,
      value: { nodes: [] },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe(
      "http://127.0.0.1:49321/api/v1/projects/project-marker/host-command",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      action: "list",
      canvasId: "main",
    });
  });

  it("prefers an explicit project and reports marker/env conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-project-host-context-"));
    await mkdir(join(root, ".clash"), { recursive: true });
    await writeFile(
      join(root, ".clash", "project.toml"),
      ["schema_version = 1", 'project_id = "marker-project"', ""].join("\n"),
      "utf8",
    );

    await expect(resolveProjectHostContext({
      cwd: root,
      projectId: "explicit-project",
      env: { CLASH_PROJECT_ID: "env-project" },
    })).resolves.toMatchObject({
      projectId: "explicit-project",
      source: "explicit",
      workspaceRoot: root,
    });
    await expect(resolveProjectHostContext({
      cwd: root,
      env: { CLASH_PROJECT_ID: "env-project" },
    })).rejects.toThrow(/conflict.*marker-project.*env-project/i);
  });
});
