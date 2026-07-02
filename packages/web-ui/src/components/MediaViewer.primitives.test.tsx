// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MediaViewer from "./MediaViewer";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("MediaViewer primitives", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the shared Dialog primitive instead of a hand-rolled modal shell", () => {
    const source = readSource("packages/web-ui/src/components/MediaViewer.tsx");

    expect(source).toContain("./ui/dialog");
    expect(source).not.toContain("window.addEventListener('keydown'");
    expect(source).not.toContain('role="dialog"');
    expect(source).not.toContain('aria-modal="true"');
  });

  it("renders media in a named dialog and closes through Dialog interactions", () => {
    const onClose = vi.fn();

    render(
      <MediaViewer
        isOpen
        onClose={onClose}
        type="image"
        src="/asset.png"
        title="Reference frame"
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Reference frame" }),
    ).toBeTruthy();
    expect(screen.getByAltText("Reference frame")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
