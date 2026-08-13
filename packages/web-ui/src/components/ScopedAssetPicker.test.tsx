// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScopedAssetPicker } from "./ScopedAssetPicker";

describe("ScopedAssetPicker", () => {
  afterEach(cleanup);

  it("renders scope groups and returns the selected source", () => {
    const onSelect = vi.fn();
    render(
      <ScopedAssetPicker
        open
        onClose={vi.fn()}
        onSelect={onSelect}
        onUpload={vi.fn()}
        sections={[
          {
            scope: "current-canvas",
            label: "Current Canvas",
            description: "Already here.",
            assets: [
              {
                assetId: "asset-1",
                sourceNodeId: "node-1",
                name: "Opening frame",
                type: "image",
                src: "/opening.png",
                thumbnail: "/opening-cover.webp",
                status: "ready",
                source: {
                  kind: "current-canvas",
                  assetId: "asset-1",
                  sourceNodeId: "node-1",
                  canvasId: "main",
                },
              },
            ],
          },
          {
            scope: "external",
            label: "More sources",
            description: "Global or local.",
            assets: [],
            allowLocalUpload: true,
          },
        ]}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Add media" })).toBeTruthy();
    expect(
      screen.getByRole("searchbox", { name: "Search media" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "Current Canvas" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Opening frame" }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-1", sourceNodeId: "node-1" }),
    );
    expect(
      screen.getByRole("button", { name: "Upload from Mac" }),
    ).toBeTruthy();
  });

  it("filters the command grid by query and scope", () => {
    render(
      <ScopedAssetPicker
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onUpload={vi.fn()}
        sections={[
          {
            scope: "current-canvas",
            label: "Current Canvas",
            description: "Already here.",
            assets: [
              {
                assetId: "asset-frame",
                sourceNodeId: "node-frame",
                name: "Opening frame",
                type: "image",
                src: "/opening.png",
                status: "ready",
                source: {
                  kind: "current-canvas",
                  assetId: "asset-frame",
                  sourceNodeId: "node-frame",
                  canvasId: "main",
                },
              },
            ],
          },
          {
            scope: "project",
            label: "Project",
            description: "Project media.",
            assets: [
              {
                assetId: "asset-voice",
                name: "Voice over",
                type: "audio",
                src: "/voice.wav",
                status: "ready",
                source: { kind: "project", assetId: "asset-voice" },
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search media" }), {
      target: { value: "voice" },
    });
    expect(
      screen.queryByRole("button", { name: "Add Opening frame" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Add Voice over" })).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search media" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Current Canvas" }));
    expect(
      screen.getByRole("button", { name: "Add Opening frame" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Voice over" })).toBeNull();
  });

  it("does not render private paths as visible or accessible copy", () => {
    render(
      <ScopedAssetPicker
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onUpload={vi.fn()}
        sections={[
          {
            scope: "project",
            label: "Project",
            description: "Project media.",
            assets: [
              {
                assetId: "asset-safe",
                name: "Image",
                type: "image",
                src: "/api/private/projects/secret.png",
                status: "ready",
                source: { kind: "project", assetId: "asset-safe" },
              },
            ],
          },
        ]}
      />,
    );
    expect(document.body.textContent).not.toContain("projects/secret.png");
    expect(screen.getByRole("button", { name: "Add Image" })).toBeTruthy();
  });

  it("shows Host availability and blocks a byte-dependent unavailable choice", () => {
    const onSelect = vi.fn();
    render(
      <ScopedAssetPicker
        open
        onClose={vi.fn()}
        onSelect={onSelect}
        onUpload={vi.fn()}
        sections={[
          {
            scope: "project",
            label: "Project",
            description: "Project media.",
            assets: [
              {
                assetId: "asset-offline",
                name: "Remote cut",
                type: "video",
                src: "",
                status: "downloading",
                progress: 0.42,
                disabledReason: "Downloading 42%",
                source: { kind: "project", assetId: "asset-offline" },
              },
            ],
          },
        ]}
      />,
    );

    const choice = screen.getByRole("button", { name: "Add Remote cut" });
    expect(choice).toBeDisabled();
    expect(screen.getByText("Downloading 42%")).toBeTruthy();
    expect(screen.getByText("0 selectable · 1 not ready")).toBeTruthy();
    fireEvent.click(choice);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps Project and Global entries distinct when their authority-local ids match", () => {
    render(
      <ScopedAssetPicker
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onUpload={vi.fn()}
        sections={[
          {
            scope: "project",
            label: "Project",
            description: "Project media.",
            assets: [
              {
                assetId: "shared-entry-id",
                name: "Project cut",
                type: "video",
                src: "/project-cut.mp4",
                status: "ready",
                source: { kind: "project", assetId: "shared-entry-id" },
              },
            ],
          },
          {
            scope: "external",
            label: "More sources",
            description: "Global media.",
            assets: [
              {
                assetId: "shared-entry-id",
                name: "Global master",
                type: "video",
                src: "/global-master.mp4",
                status: "ready",
                source: {
                  kind: "global-library",
                  assetId: "shared-entry-id",
                },
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Add Project cut" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add Global master" }),
    ).toBeTruthy();
  });
});
