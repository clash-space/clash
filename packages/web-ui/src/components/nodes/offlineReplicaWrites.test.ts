import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { sourceMatches } from "../../test-support/source-match";

const MUTATION_SOURCES = [
  "../../hooks/useCascadeRunner.ts",
  "../ImageEditorContext.tsx",
  "../VideoClipperContext.tsx",
  "../ProjectEditor.tsx",
  "ActionBadge.tsx",
  "ActionBadgePipelineMenu.tsx",
  "DraftPlaceholder.tsx",
  "GroupNode.tsx",
  "ImageNode.tsx",
  "SourceHandleMenu.tsx",
  "VideoNode.tsx",
] as const;

describe("offline Project replica writes", () => {
  it.each(MUTATION_SOURCES)(
    "%s never treats transport connectivity as permission to mutate Loro",
    (relativePath) => {
      const source = readFileSync(
        join(
          process.cwd(),
          "packages/web-ui/src/components/nodes",
          relativePath,
        ),
        "utf8",
      );

      expect(
        sourceMatches(source, /if\s*\(\s*!?loroSync\??\.connected/),
      ).toBe(false);
    },
  );
});
