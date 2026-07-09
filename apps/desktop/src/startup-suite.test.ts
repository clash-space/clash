import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const desktopRoot = new URL("..", import.meta.url);
const desktopPath = desktopRoot.pathname;

function readText(relativePath: string) {
  return readFileSync(new URL(relativePath, desktopRoot), "utf8");
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
    expect(source).toContain("agentFirstCasReportPath");
    expect(source).toContain("validateCasEvidence");
    expect(source).toContain("smoke.booleans");
    expect(source).toContain('if (report.status !== "pass")');
    expect(source).toContain("QA report status");
    expect(casSmokeSource).toContain("runDirectCanvasCliReadTokenCas");
    expect(casSmokeSource).toContain("clash canvas update");
    expect(casSmokeSource).toContain("CLASH_AGENT_MEMBER_ID");
    expect(casSmokeSource).toContain("direct canvas CLI fresh read token accepted");
    expect(casSmokeSource).toContain("direct canvas mutation envelope recorded");
    expect(casSmokeSource).toContain("direct canvas CLI mutation envelope recorded");

    expect(schema.required).toContain("cas");
    expect(schema.properties.cas).toBeTruthy();
    expect(JSON.stringify(schema.properties.cas)).toContain("missingReadProofRejected");
    expect(JSON.stringify(schema.properties.cas)).toContain("staleReadProofRejected");
    expect(JSON.stringify(schema.properties.cas)).toContain("wrongFileLockRejected");
    expect(JSON.stringify(schema.properties.cas)).toContain("copyOnWritePreservedSource");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasMissingReadTokenRejected");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasStaleReadTokenRejected");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasFreshReadTokenAccepted");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasMutationEnvelopeRecorded");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasDeleteReadTokenRequired");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasCliMissingReadTokenRejected");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasCliStaleReadTokenRejected");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasCliFreshReadTokenAccepted");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasCliMutationEnvelopeRecorded");
    expect(JSON.stringify(schema.properties.cas)).toContain("directCanvasCliDeleteReadTokenRequired");
    expect(JSON.stringify(schema.properties.cas)).toContain("textHistoryReadsHostRevisionIndex");
    expect(JSON.stringify(schema.properties.cas)).toContain("textContentRestoresHostRevisionBody");
    expect(JSON.stringify(schema.properties.cas)).toContain("timelineHistoryReadsHostRevisionIndex");
    expect(JSON.stringify(schema.properties.cas)).toContain("timelineContentRestoresHostRevisionBody");

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
    expect(source).toContain("directCanvasCliFreshReadTokenAccepted");
    expect(source).toContain("textRestoreCreatesCopyOnWriteRevisionFromHostContent");
    expect(source).toContain("timelineRestoreCreatesCopyOnWriteRevisionFromHostContent");
    expect(source).toContain("roomSyncConflictResolutionAuditRecorded");
    expect(source).toContain("localObsoleteProjectEndpointsRejected");
    expect(source).toContain("doctor before repair does not expose obsolete marker compatibility");
    expect(source).toContain("cloud-sync pending action gates block web and sharing until required mirrors are ready");
    expect(source).toContain("CLASH_AGENT_FIRST_LOCAL_V1_SUITES");
    expect(source).toContain("agent-first-local-v1-gate-report.json");
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
