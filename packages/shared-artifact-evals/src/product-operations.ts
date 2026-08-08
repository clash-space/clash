import type { ProductOperationObservation } from "./types";

const DISCOVERY_FLAGS = new Set(["--help", "-h", "--version", "-V"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value) as unknown);
    } catch {
      return undefined;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Codex may keep the MCP tool list fixed for a turn. Clash therefore supports
 * dispatching a revealed leaf operation through the stable root `clash` tool.
 * Attribute a successful dispatch to the leaf so trajectory gates stay
 * transport-neutral; plain root menu/discovery calls remain `clash`.
 */
export function effectiveMcpToolName(input: {
  tool?: unknown;
  arguments?: unknown;
}): string | undefined {
  if (typeof input.tool !== "string") return undefined;
  const args = asRecord(input.arguments);
  const operation = args?.operation;
  if (typeof operation !== "string") return input.tool;

  const completeLeaf = /^clash_(workspace|canvas|director|timeline)_[a-z0-9_]+$/u.exec(
    operation,
  );
  const legacyDispatcher = /^clash_(workspace|canvas|director|timeline)$/u.exec(
    input.tool,
  )?.[1];
  const compositionKind = args?.kind === "timeline"
    ? "timeline"
    : args?.kind === "director-stage"
      ? "director"
      : undefined;
  const rootCommand = typeof args?.command === "string" && /^[a-z0-9-]+$/u.test(args.command)
    ? args.command.replaceAll("-", "_")
    : undefined;

  if (input.tool === "clash") {
    if (!completeLeaf) return input.tool;
    return rootCommand && completeLeaf[1] !== rootCommand
      ? input.tool
      : operation;
  }

  if (input.tool === "clash_composition") {
    if (completeLeaf) {
      if (completeLeaf[1] !== "timeline" && completeLeaf[1] !== "director") {
        return input.tool;
      }
      return compositionKind && completeLeaf[1] !== compositionKind
        ? input.tool
        : operation;
    }
    return compositionKind && /^[a-z][a-z0-9_]*$/u.test(operation)
      ? `clash_${compositionKind}_${operation}`
      : input.tool;
  }

  if (!legacyDispatcher) return input.tool;
  if (completeLeaf) {
    return completeLeaf[1] === legacyDispatcher ? operation : input.tool;
  }
  return /^[a-z][a-z0-9_]*$/u.test(operation)
    ? `clash_${legacyDispatcher}_${operation}`
    : input.tool;
}

export const PRODUCT_OPERATION_IDS = [
  "canvas.add",
  "canvas.get",
  "canvas.update",
  "director.capture",
  "director.create",
  "director.get",
  "director.mutate",
  "timeline.create",
  "timeline.get",
  "timeline.render",
  "timeline.save",
  "timeline.validate",
] as const;

export type ProductOperationId = (typeof PRODUCT_OPERATION_IDS)[number];

type ProductOperationRule = {
  mcpTools?: readonly string[];
  mcpPrefixes?: readonly string[];
  cliPrefixes: readonly (readonly string[])[];
};

const PRODUCT_OPERATION_RULES: Record<ProductOperationId, ProductOperationRule> = {
  "canvas.add": {
    mcpTools: ["clash_canvas_add"],
    cliPrefixes: [["canvas", "add"]],
  },
  "canvas.get": {
    mcpTools: ["clash_canvas_get"],
    cliPrefixes: [["canvas", "get"]],
  },
  "canvas.update": {
    mcpTools: ["clash_canvas_update"],
    cliPrefixes: [["canvas", "update"]],
  },
  "director.capture": {
    mcpTools: ["clash_director_capture"],
    cliPrefixes: [["director", "capture"]],
  },
  "director.create": {
    mcpTools: ["clash_director_create"],
    cliPrefixes: [["director", "create"]],
  },
  "director.get": {
    mcpTools: ["clash_director_get"],
    cliPrefixes: [["director", "pull"]],
  },
  "director.mutate": {
    mcpTools: ["clash_director_save"],
    mcpPrefixes: [
      "clash_director_object_",
      "clash_director_camera_",
      "clash_director_scene_",
      "clash_director_keyframe_",
      "clash_director_action_",
    ],
    cliPrefixes: [
      ["director", "apply"],
      ["director", "object"],
      ["director", "camera"],
      ["director", "scene"],
      ["director", "keyframe"],
      ["director", "action"],
    ],
  },
  "timeline.create": {
    mcpTools: ["clash_timeline_create"],
    cliPrefixes: [["timeline", "create"]],
  },
  "timeline.get": {
    mcpTools: ["clash_timeline_get"],
    cliPrefixes: [["timeline", "pull"]],
  },
  "timeline.render": {
    mcpTools: ["clash_timeline_render"],
    cliPrefixes: [["timeline", "render"]],
  },
  "timeline.save": {
    mcpTools: ["clash_timeline_save"],
    cliPrefixes: [["timeline", "apply"]],
  },
  "timeline.validate": {
    mcpTools: ["clash_timeline_validate"],
    cliPrefixes: [["timeline", "validate"]],
  },
};

function startsWithArgv(argv: string[], prefix: readonly string[]): boolean {
  return prefix.every((argument, index) => argv[index] === argument);
}

function matchingMcpTool(
  rule: ProductOperationRule,
  successfulMcpTools: string[],
): string | undefined {
  return successfulMcpTools.find(
    (tool) =>
      rule.mcpTools?.includes(tool) ||
      rule.mcpPrefixes?.some((prefix) => tool.startsWith(prefix)),
  );
}

function matchingCliArgv(
  rule: ProductOperationRule,
  successfulCliArgv: string[][],
): string[] | undefined {
  return successfulCliArgv.find(
    (argv) =>
      !argv.some((argument) => DISCOVERY_FLAGS.has(argument)) &&
      rule.cliPrefixes.some((prefix) => startsWithArgv(argv, prefix)),
  );
}

export function matchRequiredProductOperations(input: {
  requiredProductOperations: string[];
  successfulMcpTools: string[];
  successfulCliArgv: string[][];
}): {
  observedProductOperations: ProductOperationObservation[];
  missingProductOperations: string[];
} {
  const observedProductOperations: ProductOperationObservation[] = [];
  const observed = new Set<string>();

  for (const operation of input.requiredProductOperations) {
    const rule = PRODUCT_OPERATION_RULES[operation as ProductOperationId];
    if (!rule) throw new Error(`Unknown Clash product operation: ${operation}`);

    const mcpTool = matchingMcpTool(rule, input.successfulMcpTools);
    if (mcpTool) {
      observed.add(operation);
      observedProductOperations.push({
        operation,
        transport: "mcp",
        invocation: mcpTool,
      });
    }

    const cliArgv = matchingCliArgv(rule, input.successfulCliArgv);
    if (cliArgv) {
      observed.add(operation);
      observedProductOperations.push({
        operation,
        transport: "cli",
        invocation: cliArgv.join(" "),
      });
    }
  }

  return {
    observedProductOperations,
    missingProductOperations: input.requiredProductOperations.filter(
      (operation) => !observed.has(operation),
    ),
  };
}
