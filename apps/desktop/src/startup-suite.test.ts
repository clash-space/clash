import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const desktopRoot = new URL("..", import.meta.url);
const desktopPath = desktopRoot.pathname;

function readText(relativePath: string) {
  return readFileSync(new URL(relativePath, desktopRoot), "utf8");
}

function readRootText(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, desktopRoot), "utf8");
}

describe("desktop startup test suite", () => {
  it("exposes startup scripts from the workspace root", () => {
    const rootPkg = JSON.parse(
      readFileSync(new URL("../../package.json", desktopRoot), "utf8"),
    ) as {
      scripts: Record<string, string>;
    };

    expect(rootPkg.scripts["test:startup"]).toBe(
      "pnpm --filter @master-clash/desktop test:startup",
    );
    expect(rootPkg.scripts["test:agent:real-codex"]).toBe(
      "pnpm --filter @master-clash/desktop test:agent:real-codex",
    );
    expect(rootPkg.scripts["test:startup:real-codex"]).toBe(
      "pnpm --filter @master-clash/desktop test:startup:real-codex",
    );
    expect(rootPkg.scripts["test:startup:real-codex-resume"]).toBe(
      "pnpm --filter @master-clash/desktop test:startup:real-codex-resume",
    );
    expect(rootPkg.scripts["test:e2e:qa-agent"]).toBe(
      "pnpm --filter @master-clash/desktop test:e2e:qa-agent",
    );
    expect(rootPkg.scripts["test:e2e:agent-first-local-v1"]).toBe(
      "pnpm --filter @master-clash/desktop test:e2e:agent-first-local-v1",
    );
    expect(rootPkg.scripts["test:e2e:agent-first-cas"]).toBe(
      "pnpm --filter @master-clash/desktop test:e2e:agent-first-cas",
    );
  });

  it("exposes layered startup scripts", () => {
    const pkg = JSON.parse(readText("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts["test:startup"]).toBe(
      "pnpm test:startup:static && pnpm test:startup:api && pnpm test:startup:ui",
    );
    expect(pkg.scripts["test:startup:static"]).toBe(
      "node scripts/prepare-clash-cli.mjs && pnpm prepare:harnesses && node e2e/startup-static.mjs",
    );
    expect(pkg.scripts["test:startup:api"]).toBe(
      "pnpm --filter @master-clash/local-api test:e2e",
    );
    expect(pkg.scripts["test:startup:ui"]).toContain("startup-ui-smoke.mjs");
    expect(pkg.scripts["test:agent:real-codex"]).toContain(
      "real-codex-acp-backend.mjs",
    );
    expect(pkg.scripts["test:startup:real-codex"]).toContain(
      "pnpm --filter @clash-space/bridge build",
    );
    expect(pkg.scripts["test:startup:real-codex"]).toContain(
      "node scripts/prepare-clash-cli.mjs",
    );
    expect(pkg.scripts["test:startup:real-codex"]).toContain(
      "pnpm prepare:harnesses",
    );
    expect(pkg.scripts["test:startup:real-codex"]).toContain(
      "real-codex-agent-browser.mjs",
    );
    expect(pkg.scripts["test:startup:real-codex-resume"]).toContain(
      "pnpm --filter @clash-space/bridge build",
    );
    expect(pkg.scripts["test:startup:real-codex-resume"]).toContain(
      "real-codex-resume-agent-browser.mjs",
    );
    expect(pkg.scripts["test:e2e:short-drama-timeline"]).toContain(
      "short-drama-timeline-smoke.mjs",
    );
    expect(pkg.scripts["test:e2e:agent-first-cas"]).toContain(
      "agent-first-cas-smoke.mjs",
    );
    expect(pkg.scripts["test:e2e:agent-first-local-v1"]).toContain(
      "agent-first-local-v1-gate.mjs",
    );
    expect(pkg.scripts["test:e2e:qa-agent"]).toContain(
      "qa-agent-codex.mjs",
    );
  });

  it("keeps startup levels as checked-in runnable scripts", () => {
    for (const relativePath of [
      "e2e/startup-static.mjs",
      "e2e/startup-ui-smoke.mjs",
      "e2e/real-codex-acp-backend.mjs",
      "e2e/real-codex-agent-browser.mjs",
      "e2e/agent-first-local-v1-gate.mjs",
      "e2e/short-drama-timeline-smoke.mjs",
      "e2e/agent-first-cas-smoke.mjs",
      "e2e/qa-agent-codex.mjs",
      "e2e/qa-agent-report.schema.json",
    ]) {
    expect(statSync(join(desktopPath, relativePath)).isFile()).toBe(true);
    }
  });

  it("runs black-box QA through Codex CLI with a structured artifact contract", () => {
    const source = readText("e2e/qa-agent-codex.mjs");
    const casSmokeSource = readText("e2e/agent-first-cas-smoke.mjs");
    const schema = JSON.parse(readText("e2e/qa-agent-report.schema.json")) as {
      required: string[];
      properties: {
        cas: unknown;
        workspaceCli: unknown;
        paths: {
          required: string[];
          properties: Record<string, unknown>;
        };
      };
    };

    expect(source).toContain('"codex"');
    expect(source).toContain('"exec"');
    expect(source).toContain("--output-schema");
    expect(source).toContain("--output-last-message");
    expect(source).toContain("--cd");
    expect(source).toContain("artifactRoot");
    expect(source).toContain("createdProjects");
    expect(source).toContain("createdSessions");
    expect(source).toContain("createdTimelines");
    expect(source).toContain("projectStatuses");
    expect(source).toContain("restoredProjects");
    expect(source).toContain("restoredSessions");
    expect(source).toContain("restoredTimelines");
    expect(source).toContain("test:e2e:short-drama-timeline");
    expect(source).toContain("test:e2e:agent-first-cas");
    expect(source).toContain("test:e2e:project-workspace-cli");
    expect(source).toContain("agentFirstCasReportPath");
    expect(source).toContain("projectWorkspaceCliReportPath");
    expect(source).toContain("validateCasEvidence");
    expect(source).toContain("validateWorkspaceCliEvidence");
    expect(source).toContain("[desktop-agent-browser] history");
    expect(source).toContain("[desktop-agent-browser] project status");
    expect(source).toContain("Do not invent or normalize session IDs");
    expect(source).toContain("validateStubRuntimeReport");
    expect(source).toContain("smoke.booleans");
    expect(source).toContain('if (report.status !== "pass")');
    expect(source).toContain("QA report status");
    expect(casSmokeSource).toContain("runDirectCanvasCliImplicitCas");
    expect(casSmokeSource).toContain("runCanvas([");
    expect(casSmokeSource).toContain("CLASH_AGENT_MEMBER_ID");
    expect(casSmokeSource).toContain("direct canvas CLI fresh implicit observation accepted");
    expect(casSmokeSource).toContain("legacy daemon receipt mutation envelope recorded");
    expect(casSmokeSource).toContain("direct canvas CLI mutation envelope recorded");

    expect(schema.required).toContain("cas");
    expect(schema.required).toContain("workspaceCli");
    expect(schema.properties.cas).toBeTruthy();
    expect(schema.properties.workspaceCli).toBeTruthy();
    expect(JSON.stringify(schema.properties.cas)).toContain("missingReadProofRejected");
    expect(JSON.stringify(schema.properties.cas)).toContain("staleReadProofRejected");
    expect(JSON.stringify(schema.properties.cas)).toContain("copyOnWritePreservedSource");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasCliWriteBeforeReadRejected");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasCliStaleObservationRejected");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasCliFreshObservationAccepted");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasCliMutationEnvelopeRecorded");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasCliDeleteReadRequired");
    expect(JSON.stringify(schema.properties.cas)).toContain("textProjectionNoLockSidecar");
    expect(JSON.stringify(schema.properties.cas)).toContain("timelineProjectionNoLockSidecar");
    expect(JSON.stringify(schema.properties.cas)).toContain("timelineEntityApplyAdvancesRevision");
    expect(JSON.stringify(schema.properties.cas)).toContain("textHistoryReadsHostRevisionIndex");
    expect(JSON.stringify(schema.properties.cas)).toContain("textContentRestoresHostRevisionBody");
    expect(JSON.stringify(schema.properties.workspaceCli)).toContain("canvasScopesStayIsolated");
    expect(JSON.stringify(schema.properties.workspaceCli)).toContain("nativeTimelineApplyUsesEntityCas");
    expect(JSON.stringify(schema.properties.workspaceCli)).toContain("daemonRestartRecoversProjectState");
    expect(JSON.stringify(schema.properties.workspaceCli)).toContain("legacyJsonDatabaseAbsent");

    expect(schema.properties.paths.required).toEqual(
      expect.arrayContaining([
        "repoRoot",
        "artifactRoot",
        "createdProjects",
        "createdSessions",
        "createdTimelines",
        "projectStatuses",
        "restoredProjects",
        "restoredSessions",
        "restoredTimelines",
      ]),
    );
    for (const key of [
      "createdProjects",
      "createdSessions",
      "createdTimelines",
      "projectStatuses",
      "restoredProjects",
      "restoredSessions",
      "restoredTimelines",
    ]) {
      expect(schema.properties.paths.properties[key]).toBeTruthy();
    }
    expect(JSON.stringify(schema)).toContain('"timeline"');
    expect(JSON.stringify(schema)).toContain('"runtimeRoot"');
  });

  it("runs the agent-first local v1 release gate over required black-box reports", () => {
    const source = readText("e2e/agent-first-local-v1-gate.mjs");

    expect(source).toContain("short-drama-timeline-smoke.mjs");
    expect(source).toContain("agent-first-cas-smoke.mjs");
    expect(source).toContain("storage-doctor-repair-smoke.mjs");
    expect(source).toContain("agent-first-asset-receipt-smoke.mjs");
    expect(source).toContain("requiredChecks");
    expect(source).toContain("requiredBooleans");
    expect(source).toContain("directCanvasCliFreshObservationAccepted");
    expect(source).toContain("textRestoreCreatesCopyOnWriteRevisionFromHostContent");
    expect(source).toContain("timelineEntityApplyAdvancesRevision");
    expect(source).toContain("project-workspace-cli");
    expect(source).toContain("localObsoleteProjectEndpointsRejected");
    expect(source).toContain("audioTranscriptionAuditRecorded");
    expect(source).toContain("projectUpdateAuditRecorded");
    expect(source).toContain("projectDeleteAuditRecorded");
    expect(source).toContain("textRevisionIndexAuditRecorded");
    expect(source).toContain("timelineRevisionIndexRemoved");
    expect(source).toContain("legacyLocalRoomReadRemoved");
    expect(source).toContain("legacyLocalRoomWriteRemoved");
    expect(source).toContain("legacyLocalRoomSyncRemoved");
    expect(source).not.toContain("roomSyncConflictResolutionAuditRecorded");
    expect(source).toContain("doctor before repair does not expose obsolete marker compatibility");
    expect(source).not.toContain("doctor repair removes old broad app-state file");
    expect(source).toContain("cloud-sync pending action gates block web and sharing until required mirrors are ready");
    expect(source).toContain("CLASH_AGENT_FIRST_LOCAL_V1_SUITES");
    expect(source).toContain("agent-first-local-v1-gate-report.json");
  });

  it("wires the agent-first local v1 release gate into CI policy", () => {
    const ciWorkflow = readRootText(".github/workflows/ci.yml");
    const releaseWorkflow = readRootText(".github/workflows/release.yml");

    expect(ciWorkflow).toContain("agent-first-local-v1");
    expect(ciWorkflow).toContain("pnpm test:e2e:agent-first-local-v1");
    expect(releaseWorkflow).toContain("agent-first-local-v1");
    expect(releaseWorkflow).toContain("pnpm test:e2e:agent-first-local-v1");
  });

  it("keeps real Codex transport diagnostics out of assistant text", async () => {
    const helpers = (await import(
      new URL("../e2e/real-codex-transcript.mjs", import.meta.url).href
    )) as {
      assistantTextFromEvents: (events: unknown[]) => string;
      diagnosticTextFromEvents: (events: unknown[]) => string;
    };
    const events = [
      {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Falling back from WebSockets to HTTPS transport. request timed out",
        },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Final answer" },
      },
    ];

    expect(helpers.assistantTextFromEvents(events)).toBe("Final answer");
    expect(helpers.diagnosticTextFromEvents(events)).toContain(
      "Falling back from WebSockets",
    );
  });

  it("reads terminal output and final answers from current Codex ACP events", async () => {
    const helpers = (await import(
      new URL("../e2e/real-codex-transcript.mjs", import.meta.url).href
    )) as {
      terminalOutputsFromEvents: (events: unknown[]) => string[];
      finalAnswerTextFromEvents: (events: unknown[]) => string;
    };
    const cwd = "/Users/test/.clash/projects/project-1";
    const events = [
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Checking." },
        _meta: { codex: { phase: "commentary" } },
      },
      {
        sessionUpdate: "tool_call_update",
        rawOutput: { formatted_output: `${cwd}\n`, exit_code: 0 },
        _meta: { terminal_output: { data: `${cwd}\n`, terminal_id: "exec-1" } },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: cwd.slice(0, 20) },
        _meta: { codex: { phase: "final_answer" } },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: cwd.slice(20) },
        _meta: { codex: { phase: "final_answer" } },
      },
    ];

    expect(helpers.terminalOutputsFromEvents(events)).toEqual([`${cwd}\n`]);
    expect(helpers.finalAnswerTextFromEvents(events)).toBe(cwd);
    expect(helpers.terminalOutputsFromEvents([{ rawOutput: "/legacy/cwd\n" }])).toEqual([
      "/legacy/cwd\n",
    ]);
    expect(helpers.finalAnswerTextFromEvents([{ type: "text", text: "/legacy/cwd" }])).toBe(
      "/legacy/cwd",
    );
  });

  it("keeps the real Codex E2E out of stub mode", () => {
    const source = readText("e2e/real-codex-agent-browser.mjs");

    expect(source).toContain("CLASH_E2E_REAL_CODEX");
    expect(source).not.toContain("CLASH_E2E_STUB_ACP");
    expect(source).not.toContain("CLASH_LOCAL_ACP_MOCK");
    expect(source).not.toContain("sk-stub");
    expect(source).not.toContain("fake-codex");
    expect(source).not.toContain("OPENAI_BASE_URL");
  });

  it("keeps the real Codex backend ACP smoke out of stub mode", () => {
    const source = readText("e2e/real-codex-acp-backend.mjs");

    expect(source).toContain("CLASH_E2E_REAL_CODEX");
    expect(source).toContain("AcpRuntimeImpl");
    expect(source).toContain("NodeSpawner");
    expect(source).toContain("clash-real-codex-home");
    expect(source).toContain("copyCodexAuthContext");
    expect(source).toContain("redactForTranscript");
    expect(source).toContain("looksLikeNetworkFailure");
    expect(source).toContain("assistantTextFromEvents");
    expect(source).toContain("diagnosticTextFromEvents");
    expect(source).not.toContain("CLASH_E2E_STUB_ACP");
    expect(source).not.toContain("CLASH_LOCAL_ACP_MOCK");
    expect(source).not.toContain("sk-stub");
    expect(source).not.toContain("fake-codex");
    expect(source).not.toContain("OPENAI_BASE_URL");
  });

  it("keeps stub UI smoke explicitly marked as stub ACP only", () => {
    const source = readText("e2e/agent-browser-smoke.mjs");

    expect(source).toContain("CLASH_E2E_STUB_ACP");
    expect(source).not.toContain("CLASH_LOCAL_ACP_MOCK");
  });

  it("starts every desktop UI smoke with an isolated Miniflare state directory", () => {
    const source = readText("e2e/agent-browser-smoke.mjs");
    const helperSource = readText("e2e/startup-shared.mjs");

    expect(source).toContain("startVite({ webPort, logs: webLogs })");
    expect(source).not.toContain('spawn("pnpm", ["--dir", webDir, "exec", "vite"');
    expect(helperSource).toContain("CLASH_WEB_E2E_PERSIST_STATE: persistStateDir");
    expect(helperSource).toContain('rm(persistStateDir, { recursive: true, force: true })');
  });

  it("keeps a permanent narrow-window project chrome check", () => {
    const source = readText("e2e/agent-browser-smoke.mjs");

    expect(source).toContain('agentBrowser(["set", "viewport", "720", "900"])');
    expect(source).toContain("narrowLayoutScreenshot");
    expect(source).toContain("sidebarWidth");
    expect(source).toContain("selectedTabWidth");
    expect(source).toContain("toolbarRailWidth");
    expect(source).toContain("Canvas tools");
    expect(source).toContain("toolbarRailWidth < 46");
    expect(source).toContain("toolbarRailWidth > 50");
    expect(source).toContain("horizontalOverflow");
  });

  it("submits the real Codex prompt with a scoped composer submit helper", () => {
    const source = readText("e2e/real-codex-agent-browser.mjs");
    const helperSource = readText("e2e/startup-shared.mjs");

    expect(source).toContain("clickComposerSubmitButton");
    expect(helperSource).toContain("button.clash-chat-input-primary");
    expect(source).not.toContain("clickComposerSend");
  });

  it("types the real Codex prompt through agent-browser keyboard input", () => {
    const helperSource = readText("e2e/startup-shared.mjs");

    expect(helperSource).toContain('"keyboard", "type"');
    expect(helperSource).not.toContain('execCommand("insertText"');
  });

  it("types the stub UI smoke prompts through the shared keyboard helper", () => {
    const source = readText("e2e/agent-browser-smoke.mjs");

    expect(source).toContain("typeComposer(agentBrowser, text)");
    expect(source).toContain("clickComposerSubmitButton(agentBrowser)");
    expect(source).not.toContain('execCommand("insertText"');
  });

  it("recovers an Electron agent-browser session that falls back to about:blank", async () => {
    const { recoverAgentBrowserTarget } = (await import(
      new URL("../e2e/startup-shared.mjs", import.meta.url).href
    )) as {
      recoverAgentBrowserTarget: (
        agentBrowser: (args: string[], options?: { allowFailure?: boolean }) => string,
        options: {
          cdpPort: number;
          expectedUrlPrefix: string;
          maxAttempts?: number;
        },
      ) => string;
    };
    const calls: string[][] = [];
    let href = "about:blank";
    const agentBrowser = (args: string[]) => {
      calls.push(args);
      if (args[0] === "close") return "";
      if (args[0] === "connect") {
        href = "http://127.0.0.1:49870/projects/project-one";
        return "";
      }
      if (args[0] === "eval") return JSON.stringify(href);
      throw new Error(`Unexpected agent-browser command: ${args.join(" ")}`);
    };

    expect(recoverAgentBrowserTarget(agentBrowser, {
      cdpPort: 49970,
      expectedUrlPrefix: "http://127.0.0.1:49870/",
      maxAttempts: 2,
    })).toBe("http://127.0.0.1:49870/projects/project-one");
    expect(calls).toEqual([
      ["close"],
      ["connect", "49970"],
      ["eval", "location.href"],
    ]);
  });

  it("reattaches the stub Electron target after a session-creating submit", () => {
    const source = readText("e2e/agent-browser-smoke.mjs");
    const sendPromptSource = source.slice(
      source.indexOf("async function sendPrompt"),
      source.indexOf("async function fetchJson"),
    );
    const submitIndex = sendPromptSource.indexOf("clickComposerSubmitButton(agentBrowser)");
    const recoverIndex = sendPromptSource.indexOf("recoverAgentBrowserTarget(agentBrowser");
    const assertionIndex = sendPromptSource.indexOf("await waitForEval(");

    expect(submitIndex).toBeGreaterThanOrEqual(0);
    expect(recoverIndex).toBeGreaterThan(submitIndex);
    expect(assertionIndex).toBeGreaterThan(recoverIndex);
  });

  it("reports exact stub session ids and persistence provenance", async () => {
    const { runtimeSessionPathObservation } = (await import(
      new URL("../e2e/startup-shared.mjs", import.meta.url).href
    )) as {
      runtimeSessionPathObservation: (input: {
        session: { id: string; threadId?: string; title?: string; projectId?: string };
        projectId: string;
        apiOrigin: string;
        dataDir: string;
        messageCount: number;
      }) => Record<string, unknown>;
    };

    expect(runtimeSessionPathObservation({
      session: {
        id: "session-row-one",
        threadId: "thread-one",
        title: "Storyboard pass",
        projectId: "project-one",
      },
      projectId: "project-one",
      apiOrigin: "http://127.0.0.1:49920",
      dataDir: "/tmp/clash-e2e-data",
      messageCount: 2,
    })).toEqual({
      id: "thread-one",
      projectId: "project-one",
      title: "Storyboard pass",
      messageCount: 2,
      apiPath: "http://127.0.0.1:49920/api/v1/local-sessions/thread-one/messages",
      storagePath: "/tmp/clash-e2e-data/local.sqlite",
      cwdPath: null,
    });
  });

  it("rejects placeholder session paths in stub Codex QA reports", async () => {
    const { validateStubRuntimeReport } = (await import(
      new URL("../e2e/qa-agent-report-validation.mjs", import.meta.url).href
    )) as {
      validateStubRuntimeReport: (report: Record<string, unknown>) => void;
    };
    const validSession = (id: string, phase: "created" | "history") => ({
      kind: "session",
      phase,
      id,
      apiPath: `http://127.0.0.1:49920/api/v1/local-sessions/${id}/messages`,
      storagePath: "/tmp/clash-e2e-data/local.sqlite",
      cwdPath: null,
    });
    const baseReport = {
      paths: {
        createdSessions: [
          validSession("session-one", "created"),
          validSession("session-two", "created"),
        ],
        restoredSessions: [validSession("session-one", "history")],
        projectStatuses: [{
          runtimeRoot: "/tmp/clash-e2e-data/projects/project-one/runtime",
          protectedPaths: ["/tmp/clash-e2e-data/projects/project-one/runtime"],
        }],
      },
    };

    expect(() => validateStubRuntimeReport(baseReport)).not.toThrow();
    expect(() => validateStubRuntimeReport({
      paths: {
        ...baseReport.paths,
        createdSessions: [
          validSession("stub-acp-session-1", "created"),
          validSession("stub-acp-session-2", "created"),
        ],
      },
    })).toThrow(/placeholder session id/i);
  });

  it("opens stub session history with the shared pointer helper and waits for the menu role", () => {
    const source = readText("e2e/agent-browser-smoke.mjs");

    expect(source).toContain("clickButtonByLabel(agentBrowser, \"Session history\")");
    expect(source).toContain("[role=\"menu\"][aria-label=\"Session history\"]");
    expect(source).toContain("clickHistoryMenuItemByText(firstPrompt)");
    expect(source).toContain("restored first session transcript");
    expect(source).not.toContain("document.querySelector(\"[role='dialog']\")");
  });

  it("waits for the real Codex turn to finish before creating a fresh session", () => {
    const source = readText("e2e/real-codex-agent-browser.mjs");

    expect(source).toContain("Codex turn idle after final answer");
    expect(source.indexOf("Codex turn idle after final answer")).toBeLessThan(source.indexOf("Could not create a fresh session"));
  });

  it("accepts the current project-root cwd in the real Codex E2E", () => {
    const source = readText("e2e/real-codex-agent-browser.mjs");

    expect(source).toContain("/.clash/projects/");
    expect(source).not.toContain("/.clash/agent/");
    expect(source).toContain("reply exactly DONE");
    expect(source).not.toContain("answer with only the path");
  });

  it("verifies real Codex project cwd materializes the v1 editable roots", () => {
    const realSource = readText("e2e/real-codex-agent-browser.mjs");
    const resumeSource = readText("e2e/real-codex-resume-agent-browser.mjs");

    for (const source of [realSource, resumeSource]) {
      expect(source).toContain("assertProjectWorkspaceLayout");
      expect(source).toContain('"drafts"');
      expect(source).toContain('"projections/text"');
      expect(source).toContain('"projections/timelines"');
      expect(source).toContain('"assets/links"');
      expect(source).toContain('"sessions"');
      expect(source).toContain('"runtime"');
      expect(source).toContain("/api/v1/projects/");
      expect(source).toContain("/status");
      expect(source).toContain("runtimeRoot");
    }
  });
});
