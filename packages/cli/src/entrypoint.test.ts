import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CLI entrypoint argv contract", () => {
  it.each(["index.ts", "plugin.ts"])(
    "%s forces Node argv semantics under ELECTRON_RUN_AS_NODE",
    (file) => {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source).toContain('program.parse(process.argv, { from: "node" })');
    },
  );
});
