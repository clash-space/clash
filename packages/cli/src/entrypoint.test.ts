import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CLI entrypoint argv contract", () => {
  it("the shared program forces Node argv semantics under ELECTRON_RUN_AS_NODE", () => {
    const source = readFileSync(new URL("./program.ts", import.meta.url), "utf8");
    expect(source).toMatch(
      /program\.parse(Async)?\(process\.argv, \{ from: "node" \}\)/,
    );
  });

  it.each(["index.ts", "plugin.ts"])("%s uses the shared runner", (file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    expect(source).toMatch(/import \{ runCli \} from "\.\/program"/);
    expect(source).toMatch(/runCli\(/);
  });
});
