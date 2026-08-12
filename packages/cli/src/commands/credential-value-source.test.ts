import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "providers.ts"), "utf8");

/**
 * Where a value comes from is a property of the value, not a second flag.
 *
 * `--api-key` and `--api-key-file` were two flags for one credential, and adding a general
 * `--credential` doubled it again to four. Every future credential would have arrived with a twin.
 *
 * curl settled this decades ago: `@` before a value means read the file at that path, and `-`
 * means stdin. One flag, and the value says where it lives.
 */
describe("a credential value can name its source", () => {
  it("reads a value beginning with @ from that file", () => {
    expect(source).toMatch(/startsWith\("@"\)|\^@/);
  });

  it("reads a bare dash from stdin", () => {
    expect(source).toMatch(/=== "-"|readFileSync\(0/);
  });

  it("no longer carries a -file twin for every credential", () => {
    expect(source).not.toMatch(/\.option\("--api-key-file/);
    expect(source).not.toMatch(/\.option\("--credential-file/);
  });

  it("takes every credential the same way, by the name the Provider declares", () => {
    // The `--api-key` shortcut is gone with the rest. It existed because apiKey is the only
    // credential most Providers have -- but "most" is what made it a special case, and a Provider
    // wanting an access key and a secret had to wait for a flag. `--set key=value` needs the key's
    // name, which is exactly what the declaration states and what the settings screen renders.
    expect(source).toMatch(/"--set <key=value>"/);
    expect(source).not.toMatch(/\.option\("--api-key/);
  });
});
