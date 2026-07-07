import { z } from "zod";

const MgAnimationPropertySchema = z.enum(["x", "y", "opacity", "scale", "rotation"]);
const MgEasingSchema = z.enum(["linear", "easeInCubic", "easeOutCubic", "easeInOutCubic"]);

export const MgAnimationSchema = z.object({
  property: MgAnimationPropertySchema,
  from: z.number(),
  to: z.number(),
  startFrame: z.number().int().min(0),
  durationInFrames: z.number().int().positive(),
  easing: MgEasingSchema.default("linear"),
});

const MgLayerBaseSchema = z.object({
  id: z.string().min(1),
  from: z.number().int().min(0).default(0),
  durationInFrames: z.number().int().positive(),
  zIndex: z.number().int().default(0),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  opacity: z.number().min(0).max(1).default(1),
  scale: z.number().positive().default(1),
  rotation: z.number().default(0),
  animations: z.array(MgAnimationSchema).default([]),
});

export const MgTextLayerSchema = MgLayerBaseSchema.extend({
  type: z.literal("text"),
  text: z.string(),
  fontFamily: z.string().default("Inter, system-ui, sans-serif"),
  fontSize: z.number().positive().default(64),
  fontWeight: z.union([z.string(), z.number()]).default(700),
  color: z.string().default("#ffffff"),
  letterSpacing: z.number().default(0),
  align: z.enum(["left", "center", "right"]).default("left"),
});

export const MgShapeLayerSchema = MgLayerBaseSchema.extend({
  type: z.literal("shape"),
  shape: z.enum(["rect", "rounded-rect", "circle"]),
  fill: z.string().default("#ffffff"),
  stroke: z.string().optional(),
  strokeWidth: z.number().min(0).optional(),
  radius: z.number().min(0).default(0),
});

export const MgCompositionLayerSchema = z.discriminatedUnion("type", [
  MgTextLayerSchema,
  MgShapeLayerSchema,
]);

export const MgCompositionSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  durationInFrames: z.number().int().positive(),
  background: z.string().default("transparent"),
  layers: z.array(MgCompositionLayerSchema).default([]),
});

export type MgAnimation = z.infer<typeof MgAnimationSchema>;
export type MgCompositionLayer = z.infer<typeof MgCompositionLayerSchema>;
export type MgCompositionSpec = z.infer<typeof MgCompositionSpecSchema>;

export type MgEvaluatedLayerStyle = {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  rotation: number;
};

export type MgOverlayManifest = {
  overlayId: string;
  sourcePath: string;
  renderedAssetPath: string;
  casApply?: {
    target: "timeline";
    mutation: "projection-only";
    applyCommand: "clash timeline apply";
    filePath: string;
    lockPath: string;
    lockRequired: true;
    lockSource?: "fresh-canvas-pull";
    nodeIdPlaceholder?: "<video-editor-node-id>";
    requiredRuntimeArgs?: string[];
    pullCommand?: "clash timeline pull";
    pullArgs?: string[];
    applyArgs?: string[];
  };
  timelineItems: Array<{
    id: string;
    type: "composition";
    compositionKind: "motion-graphics";
    runtime: "html";
    compositionId: string;
    sourcePath: string;
    renderedAssetPath: string;
    from: number;
    durationInFrames: number;
    spec: MgCompositionSpec;
    properties: { x: number; y: number; width: number; height: number; opacity: number };
  }>;
  validation: {
    durationFrames: number;
    dimensions: { width: number; height: number };
    htmlPreview: boolean;
    seekablePreview: boolean;
    currentFrameState: "data-current-frame";
    frameEvent: "clash-mg-frame";
    renderRequired: boolean;
    externalRuntime: false;
    implementation: {
      renderer: "clash-first-party-mg-composition";
      source: "first-party";
      license: "MIT";
      thirdPartyCodeCopied: false;
      externalRuntime: false;
      researchReferences: string[];
    };
  };
};

function applyEasing(t: number, easing: MgAnimation["easing"]): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (easing === "easeInCubic") return clamped ** 3;
  if (easing === "easeOutCubic") return 1 - (1 - clamped) ** 3;
  if (easing === "easeInOutCubic") {
    return clamped < 0.5 ? 4 * clamped ** 3 : 1 - ((-2 * clamped + 2) ** 3) / 2;
  }
  return clamped;
}

function roundFrameValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function evaluateMgLayerAtFrame(layer: MgCompositionLayer, frame: number): MgEvaluatedLayerStyle {
  const style: MgEvaluatedLayerStyle = {
    x: layer.x,
    y: layer.y,
    opacity: layer.opacity,
    scale: layer.scale,
    rotation: layer.rotation,
  };

  for (const animation of layer.animations ?? []) {
    const progress = (frame - animation.startFrame) / animation.durationInFrames;
    if (progress < 0) {
      continue;
    }
    const eased = applyEasing(progress, animation.easing);
    style[animation.property] = animation.from + (animation.to - animation.from) * eased;
  }

  for (const key of Object.keys(style) as Array<keyof MgEvaluatedLayerStyle>) {
    style[key] = roundFrameValue(style[key]);
  }
  return style;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function baseLayerStyle(layer: MgCompositionLayer): string {
  const width = typeof layer.width === "number" ? `${layer.width}px` : "auto";
  const height = typeof layer.height === "number" ? `${layer.height}px` : "auto";
  return [
    "position:absolute",
    `width:${width}`,
    `height:${height}`,
    "box-sizing:border-box",
    "will-change:transform,opacity",
  ].join(";");
}

function renderLayerMarkup(layer: MgCompositionLayer): string {
  if (layer.type === "shape") {
    const radius = layer.shape === "circle" ? "9999px" : `${layer.radius}px`;
    return `<div class="mg-layer mg-shape" data-layer-id="${escapeHtml(layer.id)}" style="${baseLayerStyle(layer)};background:${escapeHtml(layer.fill)};border-radius:${radius};"></div>`;
  }

  const fontWeight = String(layer.fontWeight);
  return `<div class="mg-layer mg-text" data-layer-id="${escapeHtml(layer.id)}" style="${baseLayerStyle(layer)};font-family:${escapeHtml(layer.fontFamily)};font-size:${layer.fontSize}px;font-weight:${escapeHtml(fontWeight)};color:${escapeHtml(layer.color)};letter-spacing:${layer.letterSpacing}px;text-align:${layer.align};white-space:pre-wrap;line-height:1.04;">${escapeHtml(layer.text)}</div>`;
}

export function renderMgCompositionHtml(input: MgCompositionSpec): string {
  const spec = MgCompositionSpecSchema.parse(input);
  const metadata = {
    generator: "clash-first-party-mg-composition",
    license: "first-party/MIT",
    externalRuntime: false,
  };
  const layers = spec.layers
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .map(renderLayerMarkup)
    .join("\n      ");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(spec.name ?? spec.id)}</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: #111; }
      body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; font-family: Inter, system-ui, sans-serif; }
      #stage { position: relative; overflow: hidden; width: ${spec.width}px; height: ${spec.height}px; background: ${escapeHtml(spec.background)}; transform-origin: center; }
      .mg-layer { transform-origin: 0 0; }
      .mg-text { text-wrap: balance; }
      #preview-controls { width: min(${spec.width}px, 92vw); display: flex; align-items: center; gap: 12px; color: #f8fafc; font-size: 13px; }
      #frame-scrubber { flex: 1; }
      #frame-readout { min-width: 88px; text-align: right; font-variant-numeric: tabular-nums; }
    </style>
  </head>
  <body>
    <main id="stage" data-composition-id="${escapeHtml(spec.id)}" data-fps="${spec.fps}" data-duration-frames="${spec.durationInFrames}" data-current-frame="0">
      ${layers}
    </main>
    <section id="preview-controls" aria-label="MG frame controls">
      <input id="frame-scrubber" aria-label="Frame" type="range" min="0" max="${spec.durationInFrames - 1}" step="1" value="0">
      <output id="frame-readout" for="frame-scrubber">0 / ${spec.durationInFrames - 1}</output>
    </section>
    <script>
      const spec = ${safeJson(spec)};
      const metadata = ${safeJson(metadata)};
      const stage = document.getElementById("stage");
      const scrubber = document.getElementById("frame-scrubber");
      const readout = document.getElementById("frame-readout");
      let currentFrame = 0;
      function ease(t, easing) {
        const c = Math.min(1, Math.max(0, t));
        if (easing === "easeInCubic") return c ** 3;
        if (easing === "easeOutCubic") return 1 - ((1 - c) ** 3);
        if (easing === "easeInOutCubic") return c < 0.5 ? 4 * c ** 3 : 1 - (((-2 * c + 2) ** 3) / 2);
        return c;
      }
      function layerStyleAt(layer, frame) {
        const out = { x: layer.x ?? 0, y: layer.y ?? 0, opacity: layer.opacity ?? 1, scale: layer.scale ?? 1, rotation: layer.rotation ?? 0 };
        for (const animation of layer.animations ?? []) {
          const progress = (frame - animation.startFrame) / animation.durationInFrames;
          if (progress < 0) {
            continue;
          }
          const eased = ease(progress, animation.easing ?? "linear");
          out[animation.property] = animation.from + (animation.to - animation.from) * eased;
        }
        return out;
      }
      function seek(frame) {
        const clampedFrame = Math.min(Math.max(0, Number(frame) || 0), spec.durationInFrames - 1);
        currentFrame = clampedFrame;
        stage.dataset.currentFrame = String(clampedFrame);
        scrubber.value = String(clampedFrame);
        readout.textContent = clampedFrame + " / " + (spec.durationInFrames - 1);
        const evaluatedLayers = [];
        for (const layer of spec.layers) {
          const el = document.querySelector('[data-layer-id="' + CSS.escape(layer.id) + '"]');
          if (!el) continue;
          const visible = clampedFrame >= layer.from && clampedFrame < layer.from + layer.durationInFrames;
          const style = layerStyleAt(layer, clampedFrame);
          el.style.opacity = visible ? String(style.opacity) : "0";
          el.style.transform = "translate(" + style.x + "px, " + style.y + "px) scale(" + style.scale + ") rotate(" + style.rotation + "deg)";
          evaluatedLayers.push({ id: layer.id, visible, style });
        }
        dispatchEvent(new CustomEvent("clash-mg-frame", { detail: { frame: clampedFrame, layers: evaluatedLayers } }));
        return clampedFrame;
      }
      scrubber.addEventListener("input", () => seek(scrubber.value));
      window.__CLASH_MG__ = { spec, metadata, seek, layerStyleAt, get currentFrame() { return currentFrame; } };
      seek(0);
    </script>
  </body>
</html>
`;
}

export function buildMgOverlayManifest(
  input: MgCompositionSpec,
  options: {
    sourcePath: string;
    renderedAssetPath: string;
    timelineFromFrame?: number;
    timelineProjectionPath?: string;
    timelineLockPath?: string;
    timelineCasApply?: MgOverlayManifest["casApply"];
  },
): MgOverlayManifest {
  const spec = MgCompositionSpecSchema.parse(input);
  const timelineFromFrame = options.timelineFromFrame ?? 0;
  const casApply = options.timelineCasApply ?? (options.timelineProjectionPath && options.timelineLockPath
    ? {
        target: "timeline" as const,
        mutation: "projection-only" as const,
        applyCommand: "clash timeline apply" as const,
        filePath: options.timelineProjectionPath,
        lockPath: options.timelineLockPath,
        lockRequired: true as const,
      }
    : undefined);
  return {
    overlayId: spec.id,
    sourcePath: options.sourcePath,
    renderedAssetPath: options.renderedAssetPath,
    ...(casApply ? { casApply } : {}),
    timelineItems: [
      {
        id: `overlay-${spec.id}`,
        type: "composition",
        compositionKind: "motion-graphics",
        runtime: "html",
        compositionId: spec.id,
        sourcePath: options.sourcePath,
        renderedAssetPath: options.renderedAssetPath,
        from: timelineFromFrame,
        durationInFrames: spec.durationInFrames,
        spec,
        properties: { x: 0, y: 0, width: 1, height: 1, opacity: 1 },
      },
    ],
    validation: {
      durationFrames: spec.durationInFrames,
      dimensions: { width: spec.width, height: spec.height },
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
  };
}
