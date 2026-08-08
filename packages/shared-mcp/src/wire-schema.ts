const SCHEMA_MAP_KEYWORDS = new Set([
  "$defs",
  "definitions",
  "properties",
  "patternProperties",
  "dependentSchemas",
  "x-clash-fragments",
]);

const SCHEMA_KEYWORDS = new Set([
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);

const SCHEMA_ARRAY_KEYWORDS = new Set(["allOf", "anyOf", "oneOf"]);

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      cloneJson(child),
    ]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeHomogeneousTuple(
  schema: Record<string, unknown>,
  tuple: unknown[],
  path: string,
  context: string,
): void {
  if (tuple.length === 0) {
    throw new Error(`Unsupported empty tuple in ${context} at ${path}`);
  }
  const [first, ...rest] = tuple;
  const canonical = canonicalJson(first);
  if (!rest.every((entry) => canonicalJson(entry) === canonical)) {
    throw new Error(`Unsupported heterogeneous tuple in ${context} at ${path}`);
  }
  for (const bound of ["minItems", "maxItems"] as const) {
    if (schema[bound] !== undefined && schema[bound] !== tuple.length) {
      throw new Error(
        `Tuple ${bound} conflicts with its length in ${context} at ${path}`,
      );
    }
  }
  schema.items = first;
  schema.minItems = tuple.length;
  schema.maxItems = tuple.length;
}

function projectSchemaMap(
  value: unknown,
  context: string,
  path: string,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cloneJson(value);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    projectClashMcpWireJsonSchema(child, context, `${path}.${key}`),
  ]));
}

/**
 * Project authoritative JSON Schema into the conservative subset accepted by
 * Clash MCP hosts. Only schema-bearing keywords are traversed, so examples,
 * defaults, constants, and arbitrary extension payloads remain data.
 */
export function projectClashMcpWireJsonSchema(
  value: unknown,
  context = "Clash MCP tool schema",
  path = "$",
): unknown {
  if (typeof value === "boolean") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cloneJson(value);
  }

  const source = value as Record<string, unknown>;
  const schema = cloneJson(source) as Record<string, unknown>;

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    if (source[keyword] !== undefined) {
      schema[keyword] = projectSchemaMap(
        source[keyword],
        context,
        `${path}.${keyword}`,
      );
    }
  }
  for (const keyword of SCHEMA_KEYWORDS) {
    if (source[keyword] !== undefined) {
      schema[keyword] = projectClashMcpWireJsonSchema(
        source[keyword],
        context,
        `${path}.${keyword}`,
      );
    }
  }
  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    if (Array.isArray(source[keyword])) {
      schema[keyword] = source[keyword].map((child, index) => (
        projectClashMcpWireJsonSchema(
          child,
          context,
          `${path}.${keyword}[${index}]`,
        )
      ));
    }
  }

  if (Array.isArray(source.prefixItems)) {
    const projectedTuple = source.prefixItems.map((child, index) => (
      projectClashMcpWireJsonSchema(
        child,
        context,
        `${path}.prefixItems[${index}]`,
      )
    ));
    if (source.items !== undefined && source.items !== false) {
      throw new Error(`Unsupported tuple rest schema in ${context} at ${path}.items`);
    }
    normalizeHomogeneousTuple(
      schema,
      projectedTuple,
      `${path}.prefixItems`,
      context,
    );
    delete schema.prefixItems;
  } else if (Array.isArray(source.items)) {
    const projectedTuple = source.items.map((child, index) => (
      projectClashMcpWireJsonSchema(
        child,
        context,
        `${path}.items[${index}]`,
      )
    ));
    if (source.additionalItems !== undefined && source.additionalItems !== false) {
      throw new Error(
        `Unsupported tuple additionalItems in ${context} at ${path}.additionalItems`,
      );
    }
    normalizeHomogeneousTuple(schema, projectedTuple, `${path}.items`, context);
    delete schema.additionalItems;
  } else if (source.items !== undefined) {
    schema.items = projectClashMcpWireJsonSchema(
      source.items,
      context,
      `${path}.items`,
    );
  }

  return schema;
}
