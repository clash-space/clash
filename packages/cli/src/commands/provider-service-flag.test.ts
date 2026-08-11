import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "providers.ts"), "utf8");

/**
 * Which service issued a key is not where that service runs.
 *
 * They were the same flag, called `--region`, because the stored column happens to be named that.
 * For MiniMax it reads plausibly — the international and domestic services differ by geography. For
 * Google it does not: ai-studio and agent-platform are two products, and Agent Platform has real
 * regions of its own (us-central1, global) which then had nowhere to go.
 *
 * The settings form had already called it Service. One concept, two names, and the CLI held the
 * wrong one.
 */
describe("the account says which service, separately from where", () => {
  it("asks for the service", () => {
    expect(source).toMatch(/--service <service>/);
  });

  it("no longer overloads region for it", () => {
    expect(source).not.toMatch(/--region <region>/);
  });

  it("does not offer a setting it cannot store", () => {
    // Agent Platform serves per-region hosts, so a --location belongs here eventually. It is not
    // here yet because provider_accounts has fixed columns and none of them is location: the flag
    // would have parsed, printed success, and dropped the value. A parameter that cannot be stored
    // is worse than a missing one, because the failure is silent.
    expect(source).not.toMatch(/\.option\("--location/);
  });
});
