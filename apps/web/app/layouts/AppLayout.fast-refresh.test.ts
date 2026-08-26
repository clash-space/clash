import { describe, expect, it } from "vitest";

describe("AppLayout Fast Refresh boundary", () => {
  it(
    "keeps data loaders outside the React component module",
    async () => {
      const [layoutModule, loaderModule] = await Promise.all([
        import("./AppLayout"),
        import("./appLayoutLoader"),
      ]);

      expect(Object.keys(layoutModule)).toEqual(["default"]);
      expect(loaderModule.loader).toEqual(expect.any(Function));
    },
    20_000,
  );
});
