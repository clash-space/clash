import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
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

const delayedEntranceSpec = {
  id: "delayed-entrance",
  width: 320,
  height: 180,
  fps: 24,
  durationInFrames: 60,
  layers: [{
    id: "title",
    type: "text",
    from: 0,
    durationInFrames: 60,
    x: 120,
    y: 48,
    text: "ENTER",
    opacity: 1,
    animations: [
      { property: "x", from: -240, to: 120, startFrame: 12, durationInFrames: 8, easing: "easeOutCubic" },
      { property: "opacity", from: 0, to: 1, startFrame: 12, durationInFrames: 8, easing: "linear" },
      { property: "opacity", from: 1, to: 0, startFrame: 48, durationInFrames: 8, easing: "easeInCubic" },
    ],
  }],
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

  it("holds the first keyframe pose before a delayed entrance starts", () => {
    const layer = MgCompositionSpecSchema.parse(delayedEntranceSpec).layers[0];

    expect(evaluateMgLayerAtFrame(layer, 0)).toMatchObject({ x: -240, opacity: 0 });
    expect(evaluateMgLayerAtFrame(layer, 11)).toMatchObject({ x: -240, opacity: 0 });
    expect(evaluateMgLayerAtFrame(layer, 12)).toMatchObject({ x: -240, opacity: 0 });
    expect(evaluateMgLayerAtFrame(layer, 20)).toMatchObject({ x: 120, opacity: 1 });
    expect(evaluateMgLayerAtFrame(layer, 47)).toMatchObject({ x: 120, opacity: 1 });
  });

  it("keeps the HTML preview on the same pre-entrance pose as offline rendering", () => {
    const spec = MgCompositionSpecSchema.parse(delayedEntranceSpec);
    const html = renderMgCompositionHtml(spec);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();

    const stage = { dataset: {} as Record<string, string> };
    const scrubber = { value: "0", addEventListener: () => undefined };
    const readout = { textContent: "" };
    const layerElement = { style: {} as Record<string, string> };
    const context = {
      document: {
        getElementById: (id: string) => id === "stage" ? stage : id === "frame-scrubber" ? scrubber : readout,
        querySelector: () => layerElement,
      },
      CSS: { escape: (value: string) => value },
      CustomEvent: class CustomEvent { constructor(public type: string, public init: unknown) {} },
      dispatchEvent: () => undefined,
      window: {} as Record<string, unknown>,
    };
    runInNewContext(script!, context);

    const runtime = context.window.__CLASH_MG__ as {
      layerStyleAt(layer: unknown, frame: number): { x: number; opacity: number };
    };
    expect(runtime.layerStyleAt(spec.layers[0], 0)).toMatchObject({ x: -240, opacity: 0 });
    expect(runtime.layerStyleAt(spec.layers[0], 11)).toMatchObject({ x: -240, opacity: 0 });
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
      timelineCasApply: {
        target: "timeline",
        mutation: "projection-only",
        applyCommand: "clash timeline apply",
        filePath: "projections/timelines/qa-lower-third.mg.timeline.yaml",
        timelineIdPlaceholder: "<timeline-id>",
        requiredRuntimeArgs: ["--timeline <timeline-id>"],
        pullCommand: "clash timeline pull",
        pullArgs: ["--timeline", "<timeline-id>", "--file", "timelines/main.timeline.yaml"],
        applyArgs: [
          "--timeline",
          "<timeline-id>",
          "--file",
          "projections/timelines/qa-lower-third.mg.timeline.yaml",
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
        timelineIdPlaceholder: "<timeline-id>",
        requiredRuntimeArgs: ["--timeline <timeline-id>"],
        pullCommand: "clash timeline pull",
        pullArgs: ["--timeline", "<timeline-id>", "--file", "timelines/main.timeline.yaml"],
        applyArgs: [
          "--timeline",
          "<timeline-id>",
          "--file",
          "projections/timelines/qa-lower-third.mg.timeline.yaml",
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
