import { describe, it, expect } from "vitest";
import {
  parsePromptParts,
  extractPromptText,
  composePromptWithTextRefs,
  extractAssetRefs,
  buildMention,
  hasAssetMentions,
} from "./prompt";

describe("parsePromptParts", () => {
  it("parses plain text as single text part", () => {
    const parts = parsePromptParts("Hello world");
    expect(parts).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("parses empty string as empty array", () => {
    expect(parsePromptParts("")).toEqual([]);
  });

  it("parses a single @-mention", () => {
    const parts = parsePromptParts("@[Eyewear](node:img-abc)");
    expect(parts).toEqual([
      { type: "asset_ref", label: "Eyewear", nodeId: "img-abc" },
    ]);
  });

  it("parses text before and after @-mention", () => {
    const parts = parsePromptParts(
      "Create posters for @[Eyewear](node:img-abc) brand."
    );
    expect(parts).toEqual([
      { type: "text", text: "Create posters for " },
      { type: "asset_ref", label: "Eyewear", nodeId: "img-abc" },
      { type: "text", text: " brand." },
    ]);
  });

  it("parses multiple @-mentions", () => {
    const parts = parsePromptParts(
      "Use @[Logo](node:n1) and @[Product](node:n2) together"
    );
    expect(parts).toEqual([
      { type: "text", text: "Use " },
      { type: "asset_ref", label: "Logo", nodeId: "n1" },
      { type: "text", text: " and " },
      { type: "asset_ref", label: "Product", nodeId: "n2" },
      { type: "text", text: " together" },
    ]);
  });

  it("handles @-mention at start of string", () => {
    const parts = parsePromptParts("@[Photo](node:x) is great");
    expect(parts).toEqual([
      { type: "asset_ref", label: "Photo", nodeId: "x" },
      { type: "text", text: " is great" },
    ]);
  });

  it("handles @-mention at end of string", () => {
    const parts = parsePromptParts("Look at @[Photo](node:x)");
    expect(parts).toEqual([
      { type: "text", text: "Look at " },
      { type: "asset_ref", label: "Photo", nodeId: "x" },
    ]);
  });

  it("handles consecutive @-mentions", () => {
    const parts = parsePromptParts("@[A](node:1)@[B](node:2)");
    expect(parts).toEqual([
      { type: "asset_ref", label: "A", nodeId: "1" },
      { type: "asset_ref", label: "B", nodeId: "2" },
    ]);
  });

  it("ignores regular @ signs that don't match the pattern", () => {
    const parts = parsePromptParts("email@example.com");
    expect(parts).toEqual([{ type: "text", text: "email@example.com" }]);
  });

  it("handles labels with spaces", () => {
    const parts = parsePromptParts("@[My Cool Image](node:abc123)");
    expect(parts).toEqual([
      { type: "asset_ref", label: "My Cool Image", nodeId: "abc123" },
    ]);
  });
});

describe("extractPromptText", () => {
  it("returns plain text unchanged", () => {
    const parts = parsePromptParts("Hello world");
    expect(extractPromptText(parts)).toBe("Hello world");
  });

  it("replaces @-mentions with their labels", () => {
    const parts = parsePromptParts(
      "Create posters for @[Eyewear](node:abc) brand."
    );
    expect(extractPromptText(parts)).toBe(
      "Create posters for Eyewear brand."
    );
  });

  it("handles multiple @-mentions", () => {
    const parts = parsePromptParts(
      "Combine @[Logo](node:a) with @[BG](node:b)"
    );
    expect(extractPromptText(parts)).toBe("Combine Logo with BG");
  });

  it("returns empty string for empty parts", () => {
    expect(extractPromptText([])).toBe("");
  });
});

describe("composePromptWithTextRefs", () => {
  it("appends text refs after the action prompt", () => {
    expect(composePromptWithTextRefs("Summarize", ["Scene one", "Scene two"])).toBe(
      "Summarize\n\nScene one\n\nScene two",
    );
  });

  it("uses text refs when the action prompt is still the default placeholder", () => {
    expect(composePromptWithTextRefs("# Prompt\nEnter your prompt here...", ["Narrate this"])).toBe(
      "Narrate this",
    );
  });
});

describe("extractAssetRefs", () => {
  it("returns empty array for plain text", () => {
    const parts = parsePromptParts("Hello world");
    expect(extractAssetRefs(parts)).toEqual([]);
  });

  it("extracts single ref", () => {
    const parts = parsePromptParts("Use @[Logo](node:abc)");
    expect(extractAssetRefs(parts)).toEqual([
      { nodeId: "abc", label: "Logo" },
    ]);
  });

  it("extracts multiple refs", () => {
    const parts = parsePromptParts("@[A](node:1) and @[B](node:2)");
    expect(extractAssetRefs(parts)).toEqual([
      { nodeId: "1", label: "A" },
      { nodeId: "2", label: "B" },
    ]);
  });
});

describe("buildMention", () => {
  it("builds correct markdown syntax", () => {
    expect(buildMention("Eyewear", "img-abc")).toBe(
      "@[Eyewear](node:img-abc)"
    );
  });

  it("handles labels with spaces", () => {
    expect(buildMention("My Cool Image", "abc123")).toBe(
      "@[My Cool Image](node:abc123)"
    );
  });
});

describe("image mention format (Milkdown)", () => {
  it("parses image mention from Milkdown format", () => {
    const parts = parsePromptParts("![mention:img-abc:Eyewear](https://cdn.example.com/signed?token=xyz)");
    expect(parts).toEqual([
      { type: "asset_ref", nodeId: "img-abc", label: "Eyewear" },
    ]);
  });

  it("extracts nodeId from image mention", () => {
    const parts = parsePromptParts("Make it like ![mention:img-abc:Photo](https://example.com/img.jpg) but blue");
    expect(extractAssetRefs(parts)).toEqual([
      { nodeId: "img-abc", label: "Photo" },
    ]);
    expect(extractPromptText(parts)).toBe("Make it like Photo but blue");
  });

  it("handles mixed text and image mentions in order", () => {
    const parts = parsePromptParts("@[Logo](node:logo-1) and ![mention:img-2:Photo](https://url)");
    expect(extractAssetRefs(parts)).toEqual([
      { nodeId: "logo-1", label: "Logo" },
      { nodeId: "img-2", label: "Photo" },
    ]);
  });
});

describe("hasAssetMentions", () => {
  it("returns false for plain text", () => {
    expect(hasAssetMentions("Hello world")).toBe(false);
  });

  it("returns true when @-mentions present", () => {
    expect(hasAssetMentions("Use @[Logo](node:abc)")).toBe(true);
  });

  it("returns true when image mentions present", () => {
    expect(hasAssetMentions("![mention:img-abc:Photo](https://url)")).toBe(true);
  });

  it("returns false for regular @ signs", () => {
    expect(hasAssetMentions("email@example.com")).toBe(false);
  });
});
