import { describe, expect, it } from "vitest";

import { createOutcomeResult } from "./outcome";
import {
  enforceBenchmarkIdentityIntegrity,
  inspectBenchmarkIdentityIntegrity,
} from "./identity-integrity";
import type { ArtifactBenchmarkCase, ProductExecutionReport } from "./types";

function codexEvent(
  command: string,
  options: { id?: string; output?: string } = {},
): string {
  return JSON.stringify({
    type: "item.completed",
    item: {
      id: options.id ?? "item-1",
      type: "command_execution",
      command,
      aggregated_output: options.output ?? "",
      exit_code: 0,
      status: "completed",
    },
  });
}

function claudeEvent(command: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_identity",
          name: "Bash",
          input: { command },
        },
      ],
    },
  });
}

function passingExecution(): ProductExecutionReport {
  return {
    profile: "clash-host",
    status: "pass",
    requiredProductOperations: ["timeline.save"],
    observedProductOperations: [
      {
        operation: "timeline.save",
        transport: "cli",
        invocation: "timeline apply --timeline main --json",
      },
    ],
    missingProductOperations: [],
    forbiddenProductOperations: [],
    observedForbiddenProductOperations: [],
    requiredMcpTools: [],
    observedMcpTools: [],
    missingMcpTools: [],
    requiredCliCommands: ["timeline apply"],
    observedCliCommands: ["timeline apply --timeline main --json"],
    missingCliCommands: [],
    detail: "Observed every required product operation.",
  };
}

const benchmark: ArtifactBenchmarkCase = {
  id: "identity-integrity",
  title: "Identity integrity",
  category: "timeline",
  outcome: {
    objective: "Persist one Timeline edit without bypassing CAS.",
    acceptanceCriteria: ["The Timeline edit is host verified."],
    deliverables: [
      { artifactId: "timeline", kind: "timeline", description: "Timeline" },
    ],
  },
  passScore: 100,
  timeoutMs: 10_000,
  skills: [],
  execution: {
    profile: "clash-host",
    requiredProductOperations: ["timeline.save"],
  },
  rubric: [
    {
      id: "timeline",
      type: "artifact-exists",
      artifactId: "timeline",
      weight: 1,
      required: true,
    },
  ],
};

describe("headless benchmark identity integrity", () => {
  it("detects identity bypasses in Claude Code Bash tool calls", () => {
    const report = inspectBenchmarkIdentityIntegrity({
      agentEventsText: claudeEvent(
        "CLASH_SESSION_AS_LOCAL_USER=1 CLASH_AGENT_MEMBER_ID= clash timeline apply --timeline main",
      ),
    });

    expect(report.status).toBe("fail");
    expect(report.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "local-user-override",
          source: "claude-command",
          sourceLine: 1,
        }),
        expect.objectContaining({
          code: "agent-member-id-cleared",
          source: "claude-command",
          sourceLine: 1,
        }),
      ]),
    );
  });

  it("detects explicit local-user and empty agent identity overrides in Codex commands", () => {
    const report = inspectBenchmarkIdentityIntegrity({
      codexEventsText: [
        codexEvent(
          "/bin/zsh -lc 'CLASH_SESSION_AS_LOCAL_USER=1 clash timeline apply --timeline main'",
          { id: "local-user" },
        ),
        codexEvent(
          "/bin/zsh -lc 'CLASH_AGENT_MEMBER_ID= CLASH_AGENT_NAME= clash timeline apply --timeline main'",
          { id: "empty-identity" },
        ),
      ].join("\n"),
    });

    expect(report.status).toBe("fail");
    expect(report.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "local-user-override",
          source: "codex-command",
          sourceLine: 1,
        }),
        expect.objectContaining({
          code: "agent-member-id-cleared",
          source: "codex-command",
          sourceLine: 2,
        }),
        expect.objectContaining({
          code: "agent-name-cleared",
          source: "codex-command",
          sourceLine: 2,
        }),
      ]),
    );
  });

  it("detects explicit env -u and unset identity removal", () => {
    const report = inspectBenchmarkIdentityIntegrity({
      codexEventsText: [
        codexEvent(
          "/bin/zsh -lc 'env -u CLASH_AGENT_MEMBER_ID -u CLASH_AGENT_NAME clash timeline apply --timeline main'",
          { id: "env-unset" },
        ),
        codexEvent(
          "/bin/zsh -lc 'unset CLASH_AGENT_MEMBER_ID CLASH_AGENT_NAME; clash director apply --stage main'",
          { id: "shell-unset" },
        ),
      ].join("\n"),
    });

    expect(report.violations.map(({ code }) => code)).toEqual([
      "agent-member-id-unset",
      "agent-name-unset",
      "agent-member-id-unset",
      "agent-name-unset",
    ]);
  });

  it("also inspects structured Clash CLI trace argv and command text", () => {
    const report = inspectBenchmarkIdentityIntegrity({
      codexEventsText: "",
      cliTraceText: [
        JSON.stringify({
          type: "clash.cli.started",
          pid: 41,
          argv: [
            "env",
            "-u",
            "CLASH_AGENT_MEMBER_ID",
            "clash",
            "timeline",
            "apply",
          ],
        }),
        JSON.stringify({
          type: "clash.cli.completed",
          pid: 42,
          command:
            "CLASH_SESSION_AS_LOCAL_USER=1 clash director apply --stage main",
          argv: ["director", "apply", "--stage", "main"],
          exitCode: 0,
        }),
      ].join("\n"),
    });

    expect(report.violations).toEqual([
      expect.objectContaining({
        code: "agent-member-id-unset",
        source: "clash-cli-trace",
        sourceLine: 1,
      }),
      expect.objectContaining({
        code: "local-user-override",
        source: "clash-cli-trace",
        sourceLine: 2,
      }),
    ]);
  });

  it("does not mistake normal runner injection or printed environment output for a bypass", () => {
    const report = inspectBenchmarkIdentityIntegrity({
      codexEventsText: [
        codexEvent(
          'codex exec -c mcp_servers.clash.env.CLASH_AGENT_MEMBER_ID="headless-eval-case" -c mcp_servers.clash.env.CLASH_AGENT_NAME="Headless Eval case"',
          { id: "runner-config" },
        ),
        codexEvent("/bin/zsh -lc \"env | rg '^CLASH_'\"", {
          id: "print-env",
          output:
            "CLASH_AGENT_MEMBER_ID=headless-eval-case\nCLASH_AGENT_NAME=Headless Eval case\n",
        }),
        codexEvent(
          "CLASH_AGENT_MEMBER_ID=headless-eval-case CLASH_AGENT_NAME='Headless Eval case' clash timeline apply --timeline main",
          { id: "nonempty-explicit" },
        ),
        codexEvent(
          "rg -n 'CLASH_AGENT_MEMBER_ID= clash|CLASH_SESSION_AS_LOCAL_USER=1 clash|env -u CLASH_AGENT_NAME clash' packages",
          { id: "inspect-source" },
        ),
      ].join("\n"),
      cliTraceText: JSON.stringify({
        type: "clash.cli.completed",
        pid: 50,
        argv: ["timeline", "apply", "--timeline", "main", "--json"],
        exitCode: 0,
      }),
    });

    expect(report).toMatchObject({ status: "pass", violations: [] });
  });

  it("fails an otherwise passing execution and therefore prevents the case outcome", () => {
    const integrity = inspectBenchmarkIdentityIntegrity({
      codexEventsText: codexEvent(
        "/bin/zsh -lc 'CLASH_AGENT_MEMBER_ID= clash timeline apply --timeline main'",
      ),
    });
    const execution = enforceBenchmarkIdentityIntegrity(
      passingExecution(),
      integrity,
    );
    const outcome = createOutcomeResult({
      benchmark,
      agentStatus: "completed",
      evaluationStatus: "pass",
      executionStatus: execution.status,
      score: 100,
    });

    expect(execution).toMatchObject({
      status: "fail",
      identityIntegrity: {
        status: "fail",
        violations: [
          expect.objectContaining({ code: "agent-member-id-cleared" }),
        ],
      },
    });
    expect(execution.detail).toMatch(/identity bypass/i);
    expect(outcome.status).toBe("failed");
  });
});
