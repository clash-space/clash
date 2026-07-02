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
});
