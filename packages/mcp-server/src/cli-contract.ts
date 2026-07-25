export const CLASH_CLI_NAMESPACES = [
  "init",
  "projects",
  "canvas",
  "canvases",
  "tasks",
  "action",
  "models",
  "host",
  "timeline",
  "director",
  "doctor",
  "text",
  "production",
  "assets",
  "audit",
  "effect",
  "auth",
] as const;

export type ClashCliNamespace = (typeof CLASH_CLI_NAMESPACES)[number];
export type ClashCliNamespaceToolName = `clash_cli_${ClashCliNamespace}`;

export const CLASH_CLI_NAMESPACE_TOOL_NAMES = CLASH_CLI_NAMESPACES.map(
  (namespace) => `clash_cli_${namespace}` as ClashCliNamespaceToolName,
);

export function buildCliNamespaceArgs(name: string, input: { args?: string[] }): string[] {
  const namespace = name.replace(/^clash_cli_/, "");
  if (!(CLASH_CLI_NAMESPACES as readonly string[]).includes(namespace)) {
    throw new Error(`CLI namespace ${namespace} is not exposed through MCP`);
  }
  const args = input.args ?? [];
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) {
    throw new Error("args must be an array of strings");
  }
  return [namespace, ...args];
}
