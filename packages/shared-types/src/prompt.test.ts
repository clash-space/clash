import { describe, it, expect } from "vitest";
import {
  parsePromptParts,
  extractPromptText,
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

describe("hasAssetMentions", () => {
  it("returns false for plain text", () => {
    expect(hasAssetMentions("Hello world")).toBe(false);
  });

  it("returns true when @-mentions present", () => {
    expect(hasAssetMentions("Use @[Logo](node:abc)")).toBe(true);
  });

  it("returns false for regular @ signs", () => {
    expect(hasAssetMentions("email@example.com")).toBe(false);
  });
});
