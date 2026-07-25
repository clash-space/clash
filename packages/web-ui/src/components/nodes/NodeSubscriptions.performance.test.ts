import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readNodeSource(name: string) {
  return readFileSync(
    `packages/web-ui/src/components/nodes/${name}.tsx`,
    "utf8",
  );
}

describe("canvas node subscriptions", () => {
  it.each(["ImageEditorNode", "VideoClipperNode"])(
    "%s does not subscribe to the full node or edge arrays",
    (name) => {
      const source = readNodeSource(name);

      expect(source).toContain("useNodeConnections");
      expect(source).toContain("useStore");
      expect(source).not.toContain("useNodes()");
      expect(source).not.toContain("useEdges()");
    },
  );
});
