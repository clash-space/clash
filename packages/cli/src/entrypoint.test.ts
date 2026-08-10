import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CLI entrypoint argv contract", () => {
  it.each(["index.ts", "plugin.ts"])(
    "%s forces Node argv semantics under ELECTRON_RUN_AS_NODE",
    (file) => {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      // Either parse form satisfies the contract; what matters is that argv is
      // read with Node semantics rather than Electron's.
      expect(source).toMatch(/program\.parse(Async)?\(process\.argv, \{ from: "node" \}\)/);
    },
  );
});
