import { describe, expect, it } from "vitest";
import {
  BUILTIN_ACP_WRAPPERS,
  renderCodexAcpWrapper,
  renderNodeAcpWrapper,
} from "./prepare-acp-harnesses.mjs";

describe("prepare ACP harness wrappers", () => {
  it("prepares only the built-in harness wrapper names", () => {
    expect(BUILTIN_ACP_WRAPPERS).toEqual(["codex-acp", "claude-agent-acp"]);
  });

  it("runs Codex ACP from the packaged native payload before development fallbacks", () => {
    const script = renderCodexAcpWrapper({
      packagedNativePath: "$RESOURCES_DIR/app.asar.unpacked/node_modules/@zed-industries/codex-acp-darwin-arm64/bin/codex-acp",
      devNativePath: "/repo/node_modules/@zed-industries/codex-acp-darwin-arm64/bin/codex-acp",
    });

    expect(script).toContain("app.asar.unpacked/node_modules/@zed-industries/codex-acp-darwin-arm64/bin/codex-acp");
    expect(script).toContain("exec \"$PACKAGED_NATIVE\" \"$@\"");
    expect(script).toContain("exec '/repo/node_modules/@zed-industries/codex-acp-darwin-arm64/bin/codex-acp' \"$@\"");
  });

  it("runs node-based ACP packages from a Resources-owned bundle in packaged apps", () => {
    const script = renderNodeAcpWrapper({
      packagedScriptPath: "$RESOURCES_DIR/acp-node/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
      devScriptPath: "/repo/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
    });

    expect(script).toContain("acp-node/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js");
    expect(script).not.toContain("app.asar/node_modules/@agentclientprotocol/claude-agent-acp");
    expect(script).toContain("PACKAGED_SCRIPT=");
    expect(script).toContain("if [ -f \"$PACKAGED_SCRIPT\" ]; then");
    expect(script).toContain("export ELECTRON_RUN_AS_NODE=1");
    expect(script).toContain("exec \"$CLASH_NODE_EXEC_PATH\" \"$SCRIPT\" \"$@\"");
  });
});
