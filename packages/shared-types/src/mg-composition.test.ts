import { describe, expect, it } from "vitest";
import {
  MgCompositionSpecSchema,
  buildMgOverlayManifest,
  evaluateMgLayerAtFrame,
  renderMgCompositionHtml,
} from "./mg-composition";

const lowerThirdSpec = {
  id: "qa-lower-third",
  name: "QA Lower Third",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 90,
  background: "transparent",
  layers: [
    {
      id: "bar",
      type: "shape",
      shape: "rounded-rect",
      from: 0,
      durationInFrames: 75,
      zIndex: 1,
      x: 72,
      y: 1350,
      width: 640,
      height: 132,
      radius: 28,
      fill: "#101820",
      opacity: 0,
      animations: [
        { property: "x", from: -760, to: 72, startFrame: 0, durationInFrames: 18, easing: "easeOutCubic" },
        { property: "opacity", from: 0, to: 0.92, startFrame: 0, durationInFrames: 12, easing: "linear" },
        { property: "x", from: 72, to: -760, startFrame: 64, durationInFrames: 11, easing: "easeInCubic" },
      ],
    },
    {
      id: "title",
      type: "text",
      from: 6,
      durationInFrames: 60,
      zIndex: 2,
      x: 116,
      y: 1386,
      text: "Agent owns cwd",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 56,
      fontWeight: 800,
      color: "#F8FAFC",
      opacity: 0,
      animations: [
        { property: "y", from: 1436, to: 1386, startFrame: 6, durationInFrames: 10, easing: "easeOutCubic" },
        { property: "opacity", from: 0, to: 1, startFrame: 6, durationInFrames: 8, easing: "linear" },
      ],
    },
  ],
};

describe("MG composition contract", () => {
  it("validates an agent-authored HyperFrames-style MG spec", () => {
    const spec = MgCompositionSpecSchema.parse(lowerThirdSpec);

    expect(spec.layers.map((layer) => layer.id)).toEqual(["bar", "title"]);
    expect(spec.layers[0].animations?.map((animation) => animation.property)).toEqual([
      "x",
      "opacity",
      "x",
    ]);
  });

  it("evaluates layer animation deterministically by frame", () => {
    const spec = MgCompositionSpecSchema.parse(lowerThirdSpec);

    expect(evaluateMgLayerAtFrame(spec.layers[0], 0)).toMatchObject({ x: -760, opacity: 0 });
    expect(evaluateMgLayerAtFrame(spec.layers[0], 18)).toMatchObject({ x: 72, opacity: 0.92 });
    expect(evaluateMgLayerAtFrame(spec.layers[1], 6)).toMatchObject({ y: 1436, opacity: 0 });
    expect(evaluateMgLayerAtFrame(spec.layers[1], 16)).toMatchObject({ y: 1386, opacity: 1 });
  });

  it("renders self-contained seekable HTML without pulling third-party runtime code", () => {
    const spec = MgCompositionSpecSchema.parse(lowerThirdSpec);
    const html = renderMgCompositionHtml(spec);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("window.__CLASH_MG__");
    expect(html).toContain("seek(frame)");
    expect(html).toContain('data-layer-id="title"');
    expect(html).toContain('"license":"first-party/MIT"');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("hyperframes");
  });

  it("exposes browser-verifiable frame controls and current-frame state", () => {
    const spec = MgCompositionSpecSchema.parse(lowerThirdSpec);
    const html = renderMgCompositionHtml(spec);

    expect(html).toContain('id="frame-scrubber"');
    expect(html).toContain('type="range"');
    expect(html).toContain('max="89"');
    expect(html).toContain('id="frame-readout"');
    expect(html).toContain('data-current-frame="0"');
    expect(html).toContain("stage.dataset.currentFrame = String(clampedFrame)");
    expect(html).toContain('dispatchEvent(new CustomEvent("clash-mg-frame"');
    expect(html).toContain("get currentFrame()");
  });

  it("builds a timeline overlay manifest for explicit CAS apply", () => {
    const spec = MgCompositionSpecSchema.parse(lowerThirdSpec);
    const manifest = buildMgOverlayManifest(spec, {
      sourcePath: "compositions/qa-lower-third/index.html",
      renderedAssetPath: "assets/overlays/qa-lower-third.webm",
      timelineFromFrame: 120,
      timelineProjectionPath: "projections/timelines/qa-lower-third.mg.timeline.yaml",
      timelineLockPath: "timelines/main.timeline.lock.json",
      timelineCasApply: {
        target: "timeline",
        mutation: "projection-only",
        applyCommand: "clash timeline apply",
        filePath: "projections/timelines/qa-lower-third.mg.timeline.yaml",
        lockPath: "timelines/main.timeline.lock.json",
        lockRequired: true,
        lockSource: "fresh-canvas-pull",
        nodeIdPlaceholder: "<video-editor-node-id>",
        requiredRuntimeArgs: ["--node <video-editor-node-id>"],
        pullCommand: "clash timeline pull",
        pullArgs: ["--node", "<video-editor-node-id>", "--file", "timelines/main.timeline.yaml"],
        applyArgs: [
          "--node",
          "<video-editor-node-id>",
          "--file",
          "projections/timelines/qa-lower-third.mg.timeline.yaml",
          "--lock",
          "timelines/main.timeline.lock.json",
        ],
      },
    });

    expect(manifest).toMatchObject({
      overlayId: "qa-lower-third",
      sourcePath: "compositions/qa-lower-third/index.html",
      renderedAssetPath: "assets/overlays/qa-lower-third.webm",
      casApply: {
        target: "timeline",
        mutation: "projection-only",
        applyCommand: "clash timeline apply",
        filePath: "projections/timelines/qa-lower-third.mg.timeline.yaml",
        lockPath: "timelines/main.timeline.lock.json",
        lockRequired: true,
        lockSource: "fresh-canvas-pull",
        nodeIdPlaceholder: "<video-editor-node-id>",
        requiredRuntimeArgs: ["--node <video-editor-node-id>"],
        pullCommand: "clash timeline pull",
        pullArgs: ["--node", "<video-editor-node-id>", "--file", "timelines/main.timeline.yaml"],
        applyArgs: [
          "--node",
          "<video-editor-node-id>",
          "--file",
          "projections/timelines/qa-lower-third.mg.timeline.yaml",
          "--lock",
          "timelines/main.timeline.lock.json",
        ],
      },
      timelineItems: [
        {
          id: "overlay-qa-lower-third",
          type: "composition",
          compositionKind: "motion-graphics",
          runtime: "html",
          compositionId: "qa-lower-third",
          sourcePath: "compositions/qa-lower-third/index.html",
          renderedAssetPath: "assets/overlays/qa-lower-third.webm",
          from: 120,
          durationInFrames: 90,
          properties: { x: 0, y: 0, width: 1, height: 1, opacity: 1 },
        },
      ],
      validation: {
        durationFrames: 90,
        dimensions: { width: 1080, height: 1920 },
        htmlPreview: true,
        seekablePreview: true,
        currentFrameState: "data-current-frame",
        frameEvent: "clash-mg-frame",
        renderRequired: true,
        externalRuntime: false,
        implementation: {
          renderer: "clash-first-party-mg-composition",
          source: "first-party",
          license: "MIT",
          thirdPartyCodeCopied: false,
          externalRuntime: false,
          researchReferences: ["HyperFrames"],
        },
      },
    });
    expect(manifest.timelineItems[0].spec.id).toBe("qa-lower-third");
  });
});
