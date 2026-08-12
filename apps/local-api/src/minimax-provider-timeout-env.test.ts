import { describe, expect, it } from "vitest";

import { credentialFreePluginEnv } from "./runtime/host/lib/actions-loader.js";

describe("MiniMax plugin timeout environment", () => {
  it("passes only MiniMax's non-secret runtime timeout to the MiniMax child", () => {
    const env = credentialFreePluginEnv(
      { id: "clash.minimax", version: "0.1.0" },
      {
        PATH: "/bin",
        CLASH_MINIMAX_TIMEOUT_MS: "42000",
        CLASH_MINIMAX_API_KEY: "must-not-cross",
      },
    );

    expect(env.CLASH_MINIMAX_TIMEOUT_MS).toBe("42000");
    expect(env).not.toHaveProperty("CLASH_MINIMAX_API_KEY");
  });

  it("does not expose MiniMax runtime config to another plugin", () => {
    const env = credentialFreePluginEnv(
      { id: "third.party", version: "1.0.0" },
      { CLASH_MINIMAX_TIMEOUT_MS: "42000" },
    );

    expect(env).not.toHaveProperty("CLASH_MINIMAX_TIMEOUT_MS");
  });
});
