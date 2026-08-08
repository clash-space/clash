# Shared Clash MCP boundary

`@clash/shared-mcp` is the single protocol boundary used by every Clash MCP
server. Canvas, Timeline, and Director keep their own executable schemas and
handlers; the shared server owns progressive discovery and decorates the final
`tools/list` response after the MCP SDK has generated JSON Schema.

```text
authoritative product schemas
  Canvas / Timeline / Director
              |
              v
       ClashMcpServer  <----- stdio MCP
          |       |
          |       +---- root `clash` menu
          |             command -> live contracts
          |             command + operation -> leaf execution
          v
  registered leaf handlers
              |
       MCP SDK tools/list
              |
              v
McpSchemaCompatibilityTransport
              |
         stdio or HTTP
```

CLI and MCP are peer product interfaces. The CLI discloses commands through
`clash --help` and `clash <command> --help`; MCP advertises the single `clash`
root and, when present, the bootstrap `clash_workspace_init`. Calling `clash`
without arguments returns command counts. Adding `command` returns every live
operation's command-local short name, compatible full name, input/output
schemas, annotations, product metadata, and recovery paths. Adding `operation`
and `arguments` validates against the leaf schema and invokes its handler
exactly once. The underlying leaf and former group tools stay registered for
compatible known-name calls, but never expand `tools/list` and are not the
model's discovery surface. There is deliberately no `clash_menu`,
`clash_capabilities`, or model-facing `clash_cli_*` wrapper.

The higher-level Clash skill teaches an agent how to choose either interface;
it is not part of the protocol boundary, and the runtime does not inject an
`AGENTS.md` into a user's repository.

This placement means a host-compatibility rule is implemented once in
`src/wire-schema.ts` and applies to standalone plugins, the composed Clash
plugin, CLI stdio, and HTTP sessions. Runtime validation is never weakened or
replaced.

The initial policy projects homogeneous fixed tuples from Draft-07 `items` or
2020-12 `prefixItems` into a single `items` schema with exact bounds. A
heterogeneous or open-ended tuple fails the `tools/list` request with a clear
JSON-RPC error rather than silently widening the contract or hanging the host.
Only JSON Schema-bearing keywords are traversed; examples and arbitrary
extension data remain untouched.
