import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("ChatInput primitives", () => {
  it("uses a mature dropzone primitive for file drops instead of dataTransfer plumbing", () => {
    const source = readSource("packages/web-ui/src/components/copilot/ChatInput.tsx");
    const packageJson = readSource("packages/web-ui/package.json");

    expect(packageJson).toContain("react-dropzone");
    expect(source).toContain("react-dropzone");
    expect(source).toContain("useDropzone");
    expect(source).toContain("getRootProps");
    expect(source).toContain("getInputProps");
    expect(source).not.toContain("dataTransfer");
    expect(source).not.toContain("onDrop={handleDrop}");
    expect(source).not.toContain("onDragOver={(e) => e.preventDefault()}");
  });

  it("uses shared IconButton primitives for send and stop actions", () => {
    const source = readSource("packages/web-ui/src/components/copilot/ChatInput.tsx");

    expect(source).toContain("../ui/icon-button");
    expect(source).toMatch(/<IconButton[\s\S]{0,400}onClick=\{handleFormSubmit\}[\s\S]{0,400}label=\{t\(["']copilot\.chatInput\.send["']\)\}/);
    expect(source).toMatch(/<IconButton[\s\S]{0,400}onClick=\{onStop\}[\s\S]{0,400}label=\{t\(["']copilot\.chatInput\.stop["']\)\}/);
    expect(source).not.toMatch(/<button[\s\S]*copilot\.chatInput\.send/);
    expect(source).not.toMatch(/<button[\s\S]*copilot\.chatInput\.stop/);
  });

  it("uses a shared button for dismissible error alerts instead of clickable alert divs", () => {
    const source = readSource("packages/web-ui/src/components/copilot/ChatInput.tsx");
    const errorAlertStart = source.indexOf("clash-chat-input-alert-error");
    const errorAlertEnd = source.indexOf("{voiceSetupError", errorAlertStart);
    const errorAlertSource = source.slice(errorAlertStart - 260, errorAlertEnd);

    expect(source).toContain("../ui/button");
    expect(errorAlertSource).toContain("<Button");
    expect(errorAlertSource).toContain("onClick={onDismissError}");
    expect(errorAlertSource).not.toMatch(/<motion\.div[\s\S]{0,500}onClick=\{onDismissError\}/);
  });
});
