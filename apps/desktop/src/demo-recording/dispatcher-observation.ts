type JsonRecord = Record<string, unknown>;

export type ClashDispatcherMode =
  "index" | "contract" | "contracts" | "execute";

export type ClashDispatcherName =
  "clash_assets" | "clash_canvas" | "clash_composition";

export interface ClashDispatcherCallProjection {
  dispatcher: ClashDispatcherName;
  mode: ClashDispatcherMode;
  requestedOperation?: string;
  canonicalOperation?: string;
}

const DISPATCHERS = new Set<ClashDispatcherName>([
  "clash_assets",
  "clash_canvas",
  "clash_composition",
]);
const SAFE_OPERATION = /^(?:clash_)?[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const MAX_CONTRACTS = 8;

function recordValue(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

export function isSafeClashOperation(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 120 &&
    SAFE_OPERATION.test(value)
  );
}

function safeOperation(value: unknown): string | undefined {
  return isSafeClashOperation(value) ? value : undefined;
}

export function isClashDispatcherName(
  value: unknown,
): value is ClashDispatcherName {
  return (
    typeof value === "string" && DISPATCHERS.has(value as ClashDispatcherName)
  );
}

function dispatcherName(value: unknown): ClashDispatcherName | undefined {
  return isClashDispatcherName(value)
    ? (value as ClashDispatcherName)
    : undefined;
}

function dispatcherInput(
  declaredToolName: string | undefined,
  rawInput: unknown,
): { dispatcher: ClashDispatcherName; input: JsonRecord } | undefined {
  const outer = recordValue(rawInput);
  if (!outer) return undefined;

  const hasEnvelopeIdentity =
    outer.server !== undefined || outer.tool !== undefined;
  if (hasEnvelopeIdentity) {
    if (outer.server !== undefined && outer.server !== "clash")
      return undefined;
    const wrappedTool = dispatcherName(outer.tool);
    if (
      !wrappedTool ||
      (declaredToolName !== undefined && wrappedTool !== declaredToolName)
    )
      return undefined;
    const input = recordValue(outer.arguments);
    return input ? { dispatcher: wrappedTool, input } : undefined;
  }

  const dispatcher = dispatcherName(declaredToolName);
  return dispatcher ? { dispatcher, input: outer } : undefined;
}

function canonicalOperation(
  dispatcher: ClashDispatcherName,
  requestedOperation: string,
  input: JsonRecord,
): string | undefined {
  if (requestedOperation.startsWith("clash_")) {
    if (
      (dispatcher === "clash_assets" &&
        requestedOperation.startsWith("clash_assets_")) ||
      (dispatcher === "clash_canvas" &&
        requestedOperation.startsWith("clash_canvas_")) ||
      (dispatcher === "clash_composition" &&
        (requestedOperation.startsWith("clash_timeline_") ||
          requestedOperation.startsWith("clash_director_")))
    ) {
      return requestedOperation;
    }
    return undefined;
  }
  if (dispatcher === "clash_assets") {
    return `clash_assets_${requestedOperation}`;
  }
  if (dispatcher === "clash_canvas") {
    return `clash_canvas_${requestedOperation}`;
  }
  if (input.kind === "timeline") {
    return `clash_timeline_${requestedOperation}`;
  }
  if (input.kind === "director-stage") {
    return `clash_director_${requestedOperation}`;
  }
  return undefined;
}

export function projectClashDispatcherCall(
  toolName: string | undefined,
  rawInput: unknown,
): ClashDispatcherCallProjection | undefined {
  const projectedInput = dispatcherInput(toolName, rawInput);
  if (!projectedInput) return undefined;
  const { dispatcher, input } = projectedInput;
  const selectors = ["operation", "contract", "contracts"].filter(
    (key) => input[key] !== undefined,
  );
  if (selectors.length > 1) return undefined;
  if (selectors.length === 0) return { dispatcher, mode: "index" };

  if (selectors[0] === "contracts") {
    if (
      !Array.isArray(input.contracts) ||
      input.contracts.length < 1 ||
      input.contracts.length > MAX_CONTRACTS
    ) {
      return undefined;
    }
    const contracts = input.contracts.map(safeOperation);
    if (
      contracts.some((operation) => operation === undefined) ||
      new Set(contracts).size !== contracts.length
    ) {
      return undefined;
    }
    return { dispatcher, mode: "contracts" };
  }

  const selector = selectors[0]!;
  const requestedOperation = safeOperation(input[selector]);
  if (!requestedOperation) return undefined;
  if (selector === "contract") {
    return { dispatcher, mode: "contract", requestedOperation };
  }
  const resolvedOperation = canonicalOperation(
    dispatcher,
    requestedOperation,
    input,
  );
  return {
    dispatcher,
    mode: "execute",
    requestedOperation,
    ...(resolvedOperation ? { canonicalOperation: resolvedOperation } : {}),
  };
}
