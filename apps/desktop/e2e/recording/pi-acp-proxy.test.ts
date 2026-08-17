import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

describe("Pi ACP recording proxy", () => {
  it("records only ACP method outcomes and allowlisted error classification", async () => {
    const proxyModule = await import("./pi-acp-proxy.js").catch(() => ({}));
    const createPiAcpDiagnosticTracker = (
      proxyModule as unknown as {
        createPiAcpDiagnosticTracker?: (record: (value: unknown) => void) => {
          observeInbound: (value: unknown) => void;
          observeOutbound: (value: unknown) => void;
        };
      }
    ).createPiAcpDiagnosticTracker;
    const records: unknown[] = [];

    assert.equal(typeof createPiAcpDiagnosticTracker, "function");
    if (typeof createPiAcpDiagnosticTracker !== "function") return;
    const tracker = createPiAcpDiagnosticTracker((value) =>
      records.push(value),
    );
    tracker.observeInbound({
      jsonrpc: "2.0",
      id: 17,
      method: "session/prompt",
      params: { prompt: "fixture-prompt-secret" },
    });
    tracker.observeOutbound({
      jsonrpc: "2.0",
      id: 17,
      error: {
        code: -32602,
        message: "Invalid params fixture-response-secret",
        data: {
          errorKind: "provider_error",
          httpStatus: 400,
          retryable: false,
          body: "fixture-body-secret",
        },
      },
    });
    tracker.observeInbound({
      jsonrpc: "2.0",
      id: "config-1",
      method: "session/set_config_option",
      params: { value: "fixture-config-secret" },
    });
    tracker.observeOutbound({
      jsonrpc: "2.0",
      id: "config-1",
      result: { configOptions: [{ currentValue: "fixture-result-secret" }] },
    });

    assert.deepEqual(records, [
      {
        schemaVersion: 1,
        layer: "acp",
        method: "session/prompt",
        outcome: "error",
        code: -32602,
        errorKind: "provider_error",
        httpStatus: 400,
        retryable: false,
      },
      {
        schemaVersion: 1,
        layer: "acp",
        method: "session/set_config_option",
        outcome: "ok",
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify(records),
      /fixture-(?:prompt|response|body|config|result)-secret|Invalid params/u,
    );
  });

  it("classifies Pi permission decisions without recording permission payloads", async () => {
    const proxyModule = await import("./pi-acp-proxy.js").catch(() => ({}));
    const createPiAcpDiagnosticTracker = (
      proxyModule as unknown as {
        createPiAcpDiagnosticTracker?: (record: (value: unknown) => void) => {
          observeInbound: (value: unknown) => void;
          observeOutbound: (value: unknown) => void;
        };
      }
    ).createPiAcpDiagnosticTracker;
    const records: unknown[] = [];

    assert.equal(typeof createPiAcpDiagnosticTracker, "function");
    if (typeof createPiAcpDiagnosticTracker !== "function") return;
    const tracker = createPiAcpDiagnosticTracker((value) =>
      records.push(value),
    );
    const fixtures = [
      {
        id: "permission-clash-fixture-secret",
        toolName: "mcp__clash__clash_canvas",
        response: {
          result: {
            outcome: { outcome: "selected", optionId: "allow_always" },
          },
        },
      },
      {
        id: "permission-shell-fixture-secret",
        toolName: "bash",
        response: {
          result: {
            outcome: { outcome: "selected", optionId: "reject_once" },
          },
        },
      },
      {
        id: "permission-filesystem-fixture-secret",
        toolName: "read",
        response: {
          result: {
            outcome: { outcome: "selected", optionId: "allow_once" },
          },
        },
      },
      {
        id: "permission-other-fixture-secret",
        toolName: "fixture-unknown-tool-secret",
        response: { result: { outcome: { outcome: "cancelled" } } },
      },
      {
        id: "permission-error-fixture-secret",
        toolName: "fixture-error-tool-secret",
        response: {
          error: {
            code: -32001,
            message: "fixture-permission-response-secret",
            data: { body: "fixture-permission-body-secret" },
          },
        },
      },
    ] as const;

    for (const fixture of fixtures) {
      tracker.observeOutbound({
        jsonrpc: "2.0",
        id: fixture.id,
        method: "session/request_permission",
        params: {
          sessionId: "fixture-session-secret",
          toolCall: {
            toolCallId: "fixture-tool-call-secret",
            title: fixture.toolName,
            rawInput: { prompt: "fixture-permission-prompt-secret" },
            _meta: { toolName: fixture.toolName },
          },
          options: [
            {
              optionId: "allow_once",
              name: "fixture-permission-option-secret",
              kind: "allow_once",
            },
          ],
        },
      });
      tracker.observeInbound({
        jsonrpc: "2.0",
        id: fixture.id,
        ...fixture.response,
      });
    }

    assert.deepEqual(records, [
      {
        schemaVersion: 1,
        layer: "acp",
        method: "session/request_permission",
        outcome: "ok",
        toolKind: "bundled_clash_mcp",
        decisionKind: "allow_always",
      },
      {
        schemaVersion: 1,
        layer: "acp",
        method: "session/request_permission",
        outcome: "ok",
        toolKind: "shell",
        decisionKind: "reject_once",
      },
      {
        schemaVersion: 1,
        layer: "acp",
        method: "session/request_permission",
        outcome: "ok",
        toolKind: "filesystem",
        decisionKind: "allow_once",
      },
      {
        schemaVersion: 1,
        layer: "acp",
        method: "session/request_permission",
        outcome: "ok",
        toolKind: "other",
        decisionKind: "cancelled",
      },
      {
        schemaVersion: 1,
        layer: "acp",
        method: "session/request_permission",
        outcome: "error",
        toolKind: "other",
        decisionKind: "unrecognized",
        code: -32001,
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify(records),
      /fixture-(?:session|tool-call|unknown-tool|error-tool|permission)-secret/u,
    );
  });

  it("adds only standard MCP identity to exact Clash tool starts", async () => {
    const proxyModule = await import("./pi-acp-proxy.js").catch(() => ({}));
    const annotatePiAcpMessage = (
      proxyModule as unknown as {
        annotatePiAcpMessage?: (value: unknown) => unknown;
      }
    ).annotatePiAcpMessage;
    const message = {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "pi-session",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          rawInput: {
            operation: "attach",
            arguments: { timeline_id: "signal-garden-timeline" },
          },
          _meta: { toolName: "mcp__clash__clash_timeline" },
        },
      },
    };

    assert.equal(typeof annotatePiAcpMessage, "function");
    if (typeof annotatePiAcpMessage !== "function") return;
    assert.deepEqual(annotatePiAcpMessage(message), {
      ...message,
      params: {
        ...message.params,
        update: {
          ...message.params.update,
          _meta: {
            toolName: "mcp__clash__clash_timeline",
            is_mcp_tool_call: true,
            mcp_server_name: "clash",
            mcp_tool_name: "clash_timeline",
          },
        },
      },
    });
    assert.deepEqual(message.params.update.rawInput, {
      operation: "attach",
      arguments: { timeline_id: "signal-garden-timeline" },
    });
    assert.equal(
      Object.hasOwn(
        (annotatePiAcpMessage(message) as typeof message).params.update._meta,
        "clash.host_trusted_mcp",
      ),
      false,
    );
  });

  it("adds standard MCP identity to the unified Clash dispatcher", async () => {
    const proxyModule = await import("./pi-acp-proxy.js").catch(() => ({}));
    const annotatePiAcpMessage = (
      proxyModule as unknown as {
        annotatePiAcpMessage?: (value: unknown) => unknown;
      }
    ).annotatePiAcpMessage;
    const message = {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "pi-session",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          rawInput: {},
          _meta: { toolName: "mcp__clash__clash" },
        },
      },
    };

    assert.equal(typeof annotatePiAcpMessage, "function");
    if (typeof annotatePiAcpMessage !== "function") return;
    assert.deepEqual(annotatePiAcpMessage(message), {
      ...message,
      params: {
        ...message.params,
        update: {
          ...message.params.update,
          _meta: {
            toolName: "mcp__clash__clash",
            is_mcp_tool_call: true,
            mcp_server_name: "clash",
            mcp_tool_name: "clash",
          },
        },
      },
    });
  });

  it("leaves non-Clash tools and updates without an exact Pi MCP alias unchanged", async () => {
    const proxyModule = await import("./pi-acp-proxy.js").catch(() => ({}));
    const annotatePiAcpMessage = (
      proxyModule as unknown as {
        annotatePiAcpMessage?: (value: unknown) => unknown;
      }
    ).annotatePiAcpMessage;
    assert.equal(typeof annotatePiAcpMessage, "function");
    if (typeof annotatePiAcpMessage !== "function") return;

    for (const message of [
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            _meta: { toolName: "mcp__other__clash_canvas" },
          },
        },
      },
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call_update",
            _meta: { toolName: "mcp__clash__clash_canvas" },
          },
        },
      },
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            _meta: { toolName: "prefix-mcp__clash__clash_canvas" },
          },
        },
      },
      {
        jsonrpc: "2.0",
        id: 9,
        result: {
          authMethods: [
            { id: "anthropic-api-key" },
            { id: "pi-stored-credentials" },
          ],
        },
      },
    ]) {
      assert.deepEqual(annotatePiAcpMessage(message), message);
    }
  });

  it("lets the Host probe Pi's isolated provider config without ambient API keys", async () => {
    const proxyModule = await import("./pi-acp-proxy.js").catch(() => ({}));
    const annotatePiAcpMessage = (
      proxyModule as unknown as {
        annotatePiAcpMessage?: (value: unknown) => unknown;
      }
    ).annotatePiAcpMessage;
    const response = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: 1,
        authMethods: [
          {
            id: "anthropic-api-key",
            name: "Anthropic API key",
            type: "env_var",
            vars: [{ name: "ANTHROPIC_API_KEY", secret: true }],
          },
          { id: "pi-stored-credentials", name: "pi stored credentials" },
        ],
      },
    };

    assert.equal(typeof annotatePiAcpMessage, "function");
    if (typeof annotatePiAcpMessage !== "function") return;
    const annotated = annotatePiAcpMessage(response) as typeof response;
    assert.deepEqual(
      annotated.result.authMethods.map((method) => method.id),
      ["pi-stored-credentials", "anthropic-api-key"],
    );
    assert.deepEqual(
      annotated.result.authMethods[1],
      response.result.authMethods[0],
    );
    assert.doesNotMatch(JSON.stringify(annotated), /fixture-provider-secret/u);
  });

  it("writes only proxy and child PIDs to a mode-0600 lifecycle sidecar", async () => {
    const proxyModule = await import("./pi-acp-proxy.js").catch(() => ({}));
    const writePiProcessSidecar = (
      proxyModule as unknown as {
        writePiProcessSidecar?: (
          filePath: string,
          record: { proxyPid: number; childPid: number },
        ) => Promise<void>;
      }
    ).writePiProcessSidecar;
    const root = await mkdtemp(path.join(tmpdir(), "clash-pi-process-test-"));
    const sidecarPath = path.join(root, "pi-process.json");

    try {
      assert.equal(typeof writePiProcessSidecar, "function");
      if (typeof writePiProcessSidecar !== "function") return;
      await writePiProcessSidecar(sidecarPath, {
        proxyPid: 101,
        childPid: 202,
      });

      assert.deepEqual(JSON.parse(await readFile(sidecarPath, "utf8")), {
        proxyPid: 101,
        childPid: 202,
      });
      assert.equal((await stat(sidecarPath)).mode & 0o777, 0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
