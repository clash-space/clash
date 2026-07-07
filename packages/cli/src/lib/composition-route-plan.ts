import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type CompositionRouteRuntime = "html" | "remotion" | "ffmpeg" | "manim";
export type CompositionRouteStatus = "planned" | "blocked";

export type CompositionRouteRequest = {
  compositionId: string;
  compositionKind: string;
  requirements: string[];
  availableRuntimes: CompositionRouteRuntime[];
  inputPath?: string;
  outputPath?: string;
};

export type CompositionRejectedFallback = {
  runtime: CompositionRouteRuntime;
  reason: string;
};

export type CompositionRoutePlan = {
  schemaVersion: 1;
  kind: "clash.render.composition-route";
  compositionId: string;
  compositionKind: string;
  status: CompositionRouteStatus;
  selectedRuntime: CompositionRouteRuntime | null;
  fallbackUsed: false;
  routeCommand: string | null;
  requirements: string[];
  availableRuntimes: CompositionRouteRuntime[];
  inputPath?: string;
  outputPath?: string;
  validationPlan: string[];
  decisionLog: string[];
  blockedReasons: string[];
  rejectedFallbacks: CompositionRejectedFallback[];
  createdAt: string;
};

export type PlanCompositionRouteOptions = {
  cwd: string;
  requestPath: string;
  outPath?: string;
};

export type PlanCompositionRouteResult = {
  planned: true;
  status: CompositionRouteStatus;
  compositionId: string;
  selectedRuntime: CompositionRouteRuntime | null;
  planPath: string;
};

export async function planCompositionRoute(
  options: PlanCompositionRouteOptions,
): Promise<PlanCompositionRouteResult> {
  const cwd = resolve(options.cwd);
  const requestPath = resolveProjectPath(cwd, options.requestPath, "composition route request");
  const request = parseCompositionRouteRequest(JSON.parse(await readFile(requestPath, "utf8")));
  const planPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("plans", "routes", `${safeSlug(request.compositionId)}.route.json`),
      "composition route plan",
    ),
    writeVerb: "Composition route plan",
  });
  const plan = buildCompositionRoutePlan({ cwd, request });
  await writeJson(planPath, plan);
  return {
    planned: true,
    status: plan.status,
    compositionId: plan.compositionId,
    selectedRuntime: plan.selectedRuntime,
    planPath,
  };
}

function buildCompositionRoutePlan(options: {
  cwd: string;
  request: CompositionRouteRequest;
}): CompositionRoutePlan {
  const { cwd, request } = options;
  const decision = decideCompositionRoute(request);
  return {
    schemaVersion: 1,
    kind: "clash.render.composition-route",
    compositionId: request.compositionId,
    compositionKind: request.compositionKind,
    status: decision.status,
    selectedRuntime: decision.selectedRuntime,
    fallbackUsed: false,
    routeCommand: decision.routeCommand,
    requirements: request.requirements,
    availableRuntimes: request.availableRuntimes,
    ...(request.inputPath ? { inputPath: normalizeProjectRelativePath(cwd, request.inputPath, "input path") } : {}),
    ...(request.outputPath ? { outputPath: normalizeProjectRelativePath(cwd, request.outputPath, "output path") } : {}),
    validationPlan: decision.validationPlan,
    decisionLog: decision.decisionLog,
    blockedReasons: decision.blockedReasons,
    rejectedFallbacks: decision.rejectedFallbacks,
    createdAt: new Date().toISOString(),
  };
}

function decideCompositionRoute(request: CompositionRouteRequest): Omit<
  CompositionRoutePlan,
  | "schemaVersion"
  | "kind"
  | "compositionId"
  | "compositionKind"
  | "fallbackUsed"
  | "requirements"
  | "availableRuntimes"
  | "inputPath"
  | "outputPath"
  | "createdAt"
> {
  const requirementSet = new Set(request.requirements);
  const availableSet = new Set(request.availableRuntimes);
  const decisionLog: string[] = [];

  if (requirementSet.has("react-components") || requirementSet.has("timeline-editor-integration")) {
    if (availableSet.has("remotion")) {
      return {
        status: "planned",
        selectedRuntime: "remotion",
        routeCommand: "clash render remotion",
        validationPlan: baseValidationPlan(request),
        decisionLog: ["selected remotion for react component timeline integration"],
        blockedReasons: [],
        rejectedFallbacks: [],
      };
    }
    return {
      status: "blocked",
      selectedRuntime: null,
      routeCommand: null,
      validationPlan: baseValidationPlan(request),
      decisionLog: [
        "required remotion for react component timeline integration",
        "blocked instead of silently falling back to another runtime",
      ],
      blockedReasons: ["required runtime remotion unavailable"],
      rejectedFallbacks: request.availableRuntimes
        .filter((runtime) => runtime !== "remotion")
        .map((runtime) => ({
          runtime,
          reason: `react component route cannot silently fallback to ${runtime}`,
        })),
    };
  }

  if (
    request.compositionKind === "motion-graphics" &&
    (requirementSet.has("agent-readable") || requirementSet.has("interactive-preview"))
  ) {
    if (availableSet.has("html")) {
      return {
        status: "planned",
        selectedRuntime: "html",
        routeCommand: "clash production render-mg",
        validationPlan: baseValidationPlan(request),
        decisionLog: ["selected html for agent-readable motion-graphics preview"],
        blockedReasons: [],
        rejectedFallbacks: [],
      };
    }
    return missingRequiredRuntime("html", request, "motion-graphics preview requires html runtime");
  }

  if (request.compositionKind === "math-diagram" || requirementSet.has("math-diagram")) {
    if (availableSet.has("manim")) {
      return {
        status: "planned",
        selectedRuntime: "manim",
        routeCommand: "clash render manim",
        validationPlan: baseValidationPlan(request),
        decisionLog: ["selected manim for math diagram composition"],
        blockedReasons: [],
        rejectedFallbacks: [],
      };
    }
    return missingRequiredRuntime("manim", request, "math diagram composition requires manim runtime");
  }

  if (request.compositionKind === "media-cut" || requirementSet.has("ffmpeg-render")) {
    if (availableSet.has("ffmpeg")) {
      return {
        status: "planned",
        selectedRuntime: "ffmpeg",
        routeCommand: "clash render ffmpeg",
        validationPlan: baseValidationPlan(request),
        decisionLog: ["selected ffmpeg for media cut/render composition"],
        blockedReasons: [],
        rejectedFallbacks: [],
      };
    }
    return missingRequiredRuntime("ffmpeg", request, "media cut/render composition requires ffmpeg runtime");
  }

  return {
    status: "blocked",
    selectedRuntime: null,
    routeCommand: null,
    validationPlan: baseValidationPlan(request),
    decisionLog: ["no explicit route rule matched composition request"],
    blockedReasons: ["composition route requires an explicit runtime rule"],
    rejectedFallbacks: request.availableRuntimes.map((runtime) => ({
      runtime,
      reason: `no explicit route rule permits ${runtime}`,
    })),
  };
}

function missingRequiredRuntime(
  requiredRuntime: CompositionRouteRuntime,
  request: CompositionRouteRequest,
  reason: string,
): ReturnType<typeof decideCompositionRoute> {
  return {
    status: "blocked",
    selectedRuntime: null,
    routeCommand: null,
    validationPlan: baseValidationPlan(request),
    decisionLog: [reason, "blocked instead of silently falling back to another runtime"],
    blockedReasons: [`required runtime ${requiredRuntime} unavailable`],
    rejectedFallbacks: request.availableRuntimes
      .filter((runtime) => runtime !== requiredRuntime)
      .map((runtime) => ({
        runtime,
        reason: `${requiredRuntime} route cannot silently fallback to ${runtime}`,
      })),
  };
}

function baseValidationPlan(request: CompositionRouteRequest): string[] {
  const validation = ["duration", "dimensions", "fps", "nonblank-frames"];
  if (request.requirements.includes("transparent-overlay")) validation.push("alpha");
  if (request.requirements.includes("audio")) validation.push("audio");
  return validation;
}

function parseCompositionRouteRequest(input: unknown): CompositionRouteRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Composition route request must be an object");
  }
  const record = input as Record<string, unknown>;
  return {
    compositionId: requireNonEmpty(record.compositionId, "compositionId"),
    compositionKind: requireNonEmpty(record.compositionKind, "compositionKind"),
    requirements: parseStringArray(record.requirements, "requirements"),
    availableRuntimes: parseRuntimeArray(record.availableRuntimes),
    ...(record.inputPath !== undefined ? { inputPath: requireNonEmpty(record.inputPath, "inputPath") } : {}),
    ...(record.outputPath !== undefined ? { outputPath: requireNonEmpty(record.outputPath, "outputPath") } : {}),
  };
}

function parseRuntimeArray(input: unknown): CompositionRouteRuntime[] {
  const values = parseStringArray(input, "availableRuntimes");
  return values.map((value) => {
    if (value === "html" || value === "remotion" || value === "ffmpeg" || value === "manim") {
      return value;
    }
    throw new Error(`unsupported composition runtime: ${value}`);
  });
}

function parseStringArray(input: unknown, label: string): string[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be an array`);
  }
  const values = input.map((item) => requireNonEmpty(item, label));
  return Array.from(new Set(values));
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function resolveProjectPath(cwd: string, rawPath: string, label: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error(`${label} path is required`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) {
    throw new Error(`${label} path must be a local project path, not a URL`);
  }
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
  if (!isInsideOrEqual(cwd, resolved)) {
    throw new Error(`${label} path must stay inside the current project cwd`);
  }
  return resolved;
}

function normalizeProjectRelativePath(cwd: string, rawPath: string, label: string): string {
  const resolved = resolveProjectPath(cwd, rawPath, label);
  return relative(cwd, resolved).split(sep).join("/");
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "composition";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
