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
      "node scripts/prepare-clash-cli.mjs",
    );
    expect(pkg.scripts["test:startup:real-codex"]).toContain(
      "pnpm prepare:harnesses",
    );
    expect(pkg.scripts["test:startup:real-codex"]).toContain(
      "real-codex-agent-browser.mjs",
    );
  });

  it("keeps startup levels as checked-in runnable scripts", () => {
    for (const relativePath of [
      "e2e/startup-static.mjs",
      "e2e/startup-ui-smoke.mjs",
      "e2e/real-codex-acp-backend.mjs",
      "e2e/real-codex-agent-browser.mjs",
    ]) {
    expect(statSync(join(desktopPath, relativePath)).isFile()).toBe(true);
    }
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

  it("waits for the real Codex turn to finish before creating a fresh session", () => {
    const source = readText("e2e/real-codex-agent-browser.mjs");

    expect(source).toContain("Codex turn idle after final answer");
    expect(source.indexOf("Codex turn idle after final answer")).toBeLessThan(source.indexOf("Could not create a fresh session"));
  });

  it("accepts the current project-root cwd in the real Codex E2E", () => {
    const source = readText("e2e/real-codex-agent-browser.mjs");

    expect(source).toContain(".clash\\\\/projects\\\\/");
    expect(source).not.toContain(".clash\\\\/agent\\\\/");
  });
});
