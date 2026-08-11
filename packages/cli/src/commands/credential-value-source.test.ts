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

  it("still lets the most common credential be named directly", () => {
    // apiKey is the only credential most providers have. Making the common case spell out
    // `--credential apiKey=` would also require knowing the key's name, which the provider decides.
    expect(source).toMatch(/"--api-key <value>"/);
  });
});
