import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateAgentEvidence,
  extractCompletedProductOperations,
} from "./evidence.js";
import * as evidenceModule from "./evidence.js";
import { DemoEventJournal } from "../../src/demo-recording/events.js";

describe("agent demo evidence", () => {
  it("counts Pi-direct dispatcher executions without treating disclosure calls as product operations", () => {
    const operations = extractCompletedProductOperations({
      messages: [{
        sender_kind: "agent",
        turn_id: "turn-demo",
        events: [
          {
            sessionUpdate: "tool_call",
            toolCallId: "pi-direct-execute",
            rawInput: {
              operation: "add",
              arguments: { prompt: "fixture-private-prompt" },
            },
            status: "completed",
            _meta: {
              mcp_tool_name: "clash_canvas",
              "clash.host_trusted_mcp": true,
              "clash.renderer": "product",
            },
          },
          {
            sessionUpdate: "tool_call",
            toolCallId: "pi-direct-index",
            rawInput: {},
            status: "completed",
            _meta: {
              mcp_tool_name: "clash_canvas",
              "clash.host_trusted_mcp": true,
              "clash.renderer": "product",
            },
          },
          {
            sessionUpdate: "tool_call",
            toolCallId: "pi-direct-contract",
            rawInput: { contract: "get" },
            status: "completed",
            _meta: {
              mcp_tool_name: "clash_canvas",
              "clash.host_trusted_mcp": true,
              "clash.renderer": "product",
            },
          },
          {
            sessionUpdate: "tool_call",
            toolCallId: "pi-direct-contracts",
            rawInput: { contracts: ["get", "list"] },
            status: "completed",
            _meta: {
              mcp_tool_name: "clash_canvas",
              "clash.host_trusted_mcp": true,
              "clash.renderer": "product",
            },
          },
        ],
      }],
    }, "turn-demo");

    assert.deepEqual(operations, ["clash_canvas_add"]);
    assert.doesNotMatch(JSON.stringify(operations), /fixture-private|prompt/u);
  });

  it("fails closed instead of retaining malformed operation or tool-name paths", () => {
    const operations = extractCompletedProductOperations({
      messages: [{
        sender_kind: "agent",
        turn_id: "turn-demo",
        events: [
          {
            sessionUpdate: "tool_call",
            toolCallId: "unsafe-leaf",
            rawInput: {},
            status: "completed",
            _meta: {
              mcp_tool_name: "clash_/Users/alice/private-project",
              "clash.host_trusted_mcp": true,
              "clash.renderer": "product",
            },
          },
          {
            sessionUpdate: "tool_call",
            toolCallId: "unsafe-legacy-operation",
            rawInput: {
              tool: "clash_timeline",
              arguments: { operation: "/Users/alice/private-project" },
            },
            status: "completed",
            _meta: {
              mcp_tool_name: "clash_timeline",
              "clash.host_trusted_mcp": true,
              "clash.renderer": "product",
            },
          },
        ],
      }],
    }, "turn-demo");

    assert.deepEqual(operations, []);
    assert.doesNotMatch(JSON.stringify(operations), /Users|private-project/u);
  });

  it("coalesces trusted dispatcher tool deltas into completed leaf operations", () => {
    const operations = extractCompletedProductOperations({
      messages: [
        {
          sender_kind: "agent",
          turn_id: "historical-turn",
          events: [
            {
              sessionUpdate: "tool_call",
              toolCallId: "historical-timeline-create",
              rawInput: {
                tool: "clash_timeline",
                arguments: { operation: "create" },
              },
              status: "completed",
              _meta: {
                "clash.host_trusted_mcp": true,
                "clash.renderer": "product",
              },
            },
          ],
        },
        {
          sender_kind: "agent",
          turn_id: "turn-demo",
          events: [
            {
              sessionUpdate: "tool_call",
              toolCallId: "canvas-add",
              rawInput: {
                server: "clash",
                tool: "clash_canvas",
                arguments: { operation: "add", arguments: { type: "text" } },
              },
              _meta: {
                is_mcp_tool_call: true,
                mcp_server_name: "clash",
                mcp_tool_name: "clash_canvas",
                "clash.host_trusted_mcp": true,
                "clash.renderer": "product",
              },
            },
            {
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: "canvas-add",
                status: "completed",
                rawInput: {
                  tool: "clash_timeline",
                  arguments: { operation: "create" },
                },
              },
            },
            {
              sessionUpdate: "tool_call",
              toolCallId: "director-create",
              rawInput: {
                server: "clash",
                tool: "clash_composition",
                arguments: { kind: "director-stage", operation: "create" },
              },
              _meta: {
                "clash.host_trusted_mcp": true,
                "clash.renderer": "product",
              },
            },
            {
              sessionUpdate: "tool_call_update",
              toolCallId: "director-create",
              status: "completed",
            },
            {
              sessionUpdate: "tool_call",
              toolCallId: "untrusted-shell",
              rawInput: { tool: "shell", arguments: { command: "clash timeline create" } },
              status: "completed",
            },
          ],
        },
      ],
    }, "turn-demo");

    assert.deepEqual(operations, ["clash_canvas_add", "clash_director_create"]);
  });

  it("projects trusted completed leaf operations into the score-free event trace", () => {
    const observeCompletedProductOperations = (
      evidenceModule as unknown as {
        observeCompletedProductOperations?: (
          value: unknown,
          targetTurnId: string,
          journal: DemoEventJournal,
        ) => string[];
      }
    ).observeCompletedProductOperations;
    const events: unknown[] = [];
    const journal = new DemoEventJournal({
      now: () => 10,
      onRecord: (event) => events.push(event),
    });
    const messages = {
      messages: [{
        sender_kind: "agent",
        turn_id: "turn-demo",
        events: [
          {
            sessionUpdate: "tool_call",
            toolCallId: "canvas-add-1",
            rawInput: { tool: "clash_canvas", arguments: { operation: "add" } },
            status: "completed",
            _meta: {
              "clash.host_trusted_mcp": true,
              "clash.renderer": "product",
              mcp_tool_name: "clash_canvas",
            },
          },
          {
            sessionUpdate: "tool_call",
            toolCallId: "timeline-attach-1",
            rawInput: { tool: "clash_timeline", arguments: { operation: "attach" } },
            status: "completed",
            _meta: {
              "clash.host_trusted_mcp": true,
              "clash.renderer": "product",
              mcp_tool_name: "clash_timeline",
            },
          },
        ],
      }],
    };

    assert.equal(typeof observeCompletedProductOperations, "function");
    if (typeof observeCompletedProductOperations !== "function") return;
    assert.deepEqual(
      observeCompletedProductOperations(messages, "turn-demo", journal),
      ["clash_canvas_add", "clash_timeline_attach"],
    );
    assert.deepEqual(events, [
      {
        schemaVersion: 1,
        sequence: 1,
        monotonicMs: 0,
        source: "product",
        type: "product.operation.completed",
        turnId: "turn-demo",
        label: "clash_canvas_add",
        status: "completed",
      },
      {
        schemaVersion: 1,
        sequence: 2,
        monotonicMs: 0,
        source: "product",
        type: "product.operation.completed",
        turnId: "turn-demo",
        label: "clash_timeline_attach",
        status: "completed",
      },
    ]);
  });

  it("fails when a required product operation was not observed", () => {
    const result = evaluateAgentEvidence({
      requirements: {
        operations: [
          { name: "clash_canvas_add", minCalls: 2 },
          { name: "clash_director_create", minCalls: 1 },
          { name: "clash_timeline_create", minCalls: 1 },
        ],
        minimumProductState: {
          canvasNodes: 4,
          timelines: 1,
          directorStages: 1,
        },
      },
      completedOperations: [
        "clash_canvas_add",
        "clash_canvas_add",
        "clash_timeline_create",
      ],
      readback: {
        canvas: { nodes: [{}, {}, {}, {}] },
        timelines: { timelines: [{}] },
        directorStages: { stages: [{}] },
      },
    });

    assert.equal(result.status, "fail");
    assert.deepEqual(result.missingOperations, [
      { name: "clash_director_create", expected: 1, observed: 0 },
    ]);
    assert.match(result.failures[0] ?? "", /clash_director_create/u);
  });

  it("passes only when both trajectory and product readback satisfy the case", () => {
    const result = evaluateAgentEvidence({
      requirements: {
        operations: [
          { name: "clash_canvas_add", minCalls: 2 },
          { name: "clash_director_create", minCalls: 1 },
          { name: "clash_timeline_create", minCalls: 1 },
        ],
        minimumProductState: {
          canvasNodes: 4,
          timelines: 1,
          directorStages: 1,
        },
      },
      completedOperations: [
        "clash_canvas_add",
        "clash_director_create",
        "clash_canvas_add",
        "clash_timeline_create",
      ],
      readback: {
        canvas: { nodes: [{}, {}, {}, {}] },
        timelines: { timelines: [{ id: "timeline-demo" }] },
        directorStages: { stages: [{ id: "stage-demo" }] },
      },
    });

    assert.deepEqual(result, {
      status: "pass",
      failures: [],
      missingOperations: [],
      missingProductState: [],
      metrics: {
        canvasNodes: 4,
        timelines: 1,
        directorStages: 1,
        completedOperationCounts: {
          clash_canvas_add: 2,
          clash_director_create: 1,
          clash_timeline_create: 1,
        },
      },
    });
  });

  it("fails a visually empty product readback even when tool calls succeeded", () => {
    const result = evaluateAgentEvidence({
      requirements: {
        operations: [{ name: "clash_timeline_create", minCalls: 1 }],
        minimumProductState: {
          canvasNodes: 1,
          timelines: 1,
          directorStages: 1,
        },
      },
      completedOperations: ["clash_timeline_create"],
      readback: {
        canvas: { nodes: [{}] },
        timelines: { timelines: [] },
        directorStages: { stages: [] },
      },
    });

    assert.equal(result.status, "fail");
    assert.deepEqual(result.metrics, {
      canvasNodes: 1,
      timelines: 0,
      directorStages: 0,
      completedOperationCounts: { clash_timeline_create: 1 },
    });
    assert.deepEqual(result.failures, [
      "expected at least 1 Timeline, observed 0",
      "expected at least 1 Director Stage, observed 0",
    ]);
  });

  it("rejects the wrong Timeline identity even when minimum counts pass", () => {
    const expectedTimeline = {
      id: "signal-garden-timeline",
      name: "Signal Garden Cut",
      owner: { kind: "canvas-action" as const, canvasId: "main" },
    };
    const result = evaluateAgentEvidence({
      requirements: {
        operations: [],
        minimumProductState: {
          canvasNodes: 1,
          timelines: 1,
          directorStages: 0,
        },
        requiredProductState: {
          timelines: [expectedTimeline],
        },
      },
      completedOperations: [],
      readback: {
        canvas: { nodes: [{ id: "some-node" }] },
        timelines: {
          timelines: [{
            id: "plausible-but-wrong-id",
            name: "Signal Garden Cut",
            owner: {
              kind: "canvas-action",
              canvasId: "main",
              actionNodeId: "timeline-action-1",
            },
          }],
        },
        directorStages: { stages: [] },
      },
    });

    assert.equal(result.metrics.timelines, 1);
    assert.equal(result.status, "fail");
    assert.deepEqual(result.missingProductState, [{
      kind: "timeline",
      expected: expectedTimeline,
    }]);
    assert.match(result.failures.at(-1) ?? "", /signal-garden-timeline/u);
  });

  it("rejects an unattached Director Stage even when its id and name match", () => {
    const expectedStage = {
      id: "signal-garden-stage",
      name: "Signal Garden Stage",
      owner: { kind: "canvas-action" as const, canvasId: "main" },
    };
    const result = evaluateAgentEvidence({
      requirements: {
        operations: [],
        minimumProductState: {
          canvasNodes: 0,
          timelines: 0,
          directorStages: 1,
        },
        requiredProductState: {
          directorStages: [expectedStage],
        },
      },
      completedOperations: [],
      readback: {
        canvas: { nodes: [] },
        timelines: { timelines: [] },
        directorStages: {
          stages: [{
            id: "signal-garden-stage",
            name: "Signal Garden Stage",
            owner: { kind: "project" },
          }],
        },
      },
    });

    assert.equal(result.metrics.directorStages, 1);
    assert.equal(result.status, "fail");
    assert.deepEqual(result.missingProductState, [{
      kind: "directorStage",
      expected: expectedStage,
    }]);
    assert.match(result.failures.at(-1) ?? "", /owner\.kind=canvas-action/u);
  });

  it("matches required Canvas nodes by structural type and label", () => {
    const result = evaluateAgentEvidence({
      requirements: {
        operations: [],
        minimumProductState: {
          canvasNodes: 2,
          timelines: 0,
          directorStages: 0,
        },
        requiredProductState: {
          canvasNodes: [
            { type: "text", label: "Brief" },
            { type: "text", label: "Beat Sheet" },
          ],
        },
      },
      completedOperations: [],
      readback: {
        canvas: {
          nodes: [
            { id: "brief", type: "text", data: { label: "Brief", content: "private" } },
            { id: "beats", type: "text", data: { label: "Beat Sheet", content: "private" } },
          ],
        },
        timelines: { timelines: [] },
        directorStages: { stages: [] },
      },
    });

    assert.equal(result.status, "pass");
    assert.deepEqual(result.missingProductState, []);
  });

  it("rejects a text node whose persisted content does not match the brief", () => {
    const expected = {
      type: "text",
      label: "Brief",
      content: "A lone signal wakes a quiet garden at dusk",
    };
    const result = evaluateAgentEvidence({
      requirements: {
        operations: [],
        minimumProductState: {
          canvasNodes: 1,
          timelines: 0,
          directorStages: 0,
        },
        requiredProductState: { canvasNodes: [expected] },
      },
      completedOperations: [],
      readback: {
        canvas: {
          nodes: [{
            id: "brief",
            type: "text",
            data: { label: "Brief", content: "A different brief" },
          }],
        },
        timelines: { timelines: [] },
        directorStages: { stages: [] },
      },
    });

    assert.equal(result.status, "fail");
    assert.deepEqual(result.missingProductState, [{
      kind: "canvasNode",
      expected: { ...expected, content: "<exact>" },
    }]);
    assert.doesNotMatch(
      JSON.stringify(result.missingProductState),
      /A lone signal wakes/u,
    );
  });

  it("rejects the wrong name for a name-based feature requirement", () => {
    const result = evaluateAgentEvidence({
      requirements: {
        operations: [],
        minimumProductState: {
          canvasNodes: 0,
          timelines: 1,
          directorStages: 0,
        },
        requiredProductState: {
          timelines: [{ name: "Signal Garden Feature Cut" }],
        },
      },
      completedOperations: [],
      readback: {
        canvas: { nodes: [] },
        timelines: {
          timelines: [{
            id: "generated-id",
            name: "Unrelated Timeline",
            owner: { kind: "project" },
          }],
        },
        directorStages: { stages: [] },
      },
    });

    assert.equal(result.status, "fail");
    assert.deepEqual(result.missingProductState, [{
      kind: "timeline",
      expected: { name: "Signal Garden Feature Cut" },
    }]);
  });

  for (const [field, node] of [
    ["type", { id: "brief", type: "image", data: { label: "Brief" } }],
    ["label", { id: "brief", type: "text", data: { label: "Other" } }],
  ] as const) {
    it(`rejects a Canvas node with the wrong ${field}`, () => {
      const result = evaluateAgentEvidence({
        requirements: {
          operations: [],
          minimumProductState: {
            canvasNodes: 1,
            timelines: 0,
            directorStages: 0,
          },
          requiredProductState: {
            canvasNodes: [{ type: "text", label: "Brief" }],
          },
        },
        completedOperations: [],
        readback: {
          canvas: { nodes: [node] },
          timelines: { timelines: [] },
          directorStages: { stages: [] },
        },
      });

      assert.equal(result.status, "fail");
      assert.deepEqual(result.missingProductState, [{
        kind: "canvasNode",
        expected: { type: "text", label: "Brief" },
      }]);
    });
  }
});
