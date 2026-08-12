import { describe, expect, it } from "vitest";

import { normalizeSource, sourceContains, sourceMatches } from "./source-match";

/**
 * The helper exists to survive reflow, not to make assertions pass. These tests
 * pin both halves of that: formatting is ignored, missing mechanisms are not.
 */
describe("normalizeSource", () => {
  const wrapped = `const directorPanoramaModel = MODEL_CARDS.find(
  (card) => card.id === "gpt-image-2",
);`;
  const inline = `const directorPanoramaModel = MODEL_CARDS.find((card) => card.id === "gpt-image-2")`;

  it("treats a reflowed call as the same source", () => {
    expect(sourceContains(wrapped, inline)).toBe(true);
  });

  it("treats a reflowed JSX prop as the same source", () => {
    const jsx = `<Navigator\n    onSelect={\n      focusCanvasFolderNode\n    }\n  />`;
    expect(sourceContains(jsx, "onSelect={focusCanvasFolderNode}")).toBe(true);
  });

  it("still fails when the mechanism is absent", () => {
    expect(sourceContains(wrapped, "onSelect={focusCanvasFolderNode}")).toBe(false);
    expect(sourceContains(wrapped, 'card.id === "gpt-image-3"')).toBe(false);
  });

  it("does not collapse distinct identifiers into each other", () => {
    expect(sourceContains("const abc = 1;", "const ab = 1;")).toBe(false);
    expect(sourceContains("foo(bar)", "foo(baz)")).toBe(false);
  });

  it("keeps string contents intact", () => {
    // A literal with meaningful internal spacing must not be silently rewritten
    // into a match for a different literal.
    expect(sourceContains('label="Select mode"', 'label="Selectmode"')).toBe(false);
  });

  it("applies patterns against the normalized form", () => {
    expect(sourceMatches(wrapped, /MODEL_CARDS\.find\(\(card\) =>/u)).toBe(true);
    expect(sourceMatches(wrapped, /MODEL_CARDS\.filter/u)).toBe(false);
  });

  it("is idempotent", () => {
    expect(normalizeSource(normalizeSource(wrapped))).toBe(normalizeSource(wrapped));
  });

  it("treats quote style as formatting, not meaning", () => {
    // Prettier picks the delimiter, so a suite must not fail because the source
    // spells an identical import with the other quote.
    expect(sourceContains(`import { Toolbar } from "radix-ui";`, `import { Toolbar } from 'radix-ui'`)).toBe(true);
    expect(sourceContains(`const mode = 'select';`, `const mode = "select"`)).toBe(true);
  });

  it("leaves a literal's own quotes alone", () => {
    // Rewriting delimiters must not reach inside content: an apostrophe or a nested
    // quote is part of the string, and collapsing it would let two different literals
    // compare equal.
    expect(sourceContains(`const label = "it's here";`, `const label = "it's here"`)).toBe(true);
    expect(sourceContains(`const label = "it's here";`, `const label = "its here"`)).toBe(false);
    expect(sourceContains(`const q = '"quoted"';`, `const q = '"other"'`)).toBe(false);
  });

  it("treats a wrapped JSX tag as the same tag", () => {
    // Prettier closes a multi-prop tag on its own line, so the inline and wrapped
    // forms differ only by whitespace before `>`.
    const wrapped = `<Tooltip\n  label="Undo"\n  placement="right"\n>`;
    expect(sourceContains(wrapped, `<Tooltip label="Undo" placement="right">`)).toBe(true);
    const selfClosing = `<Input\n  type="number"\n/>`;
    expect(sourceContains(selfClosing, `<Input type="number" />`)).toBe(true);
    // A different prop value must still fail.
    expect(sourceContains(wrapped, `<Tooltip label="Undo" placement="left">`)).toBe(false);
  });

  it("normalizes the pattern too, not just the source", () => {
    // Normalizing one side only reintroduces the mismatch this module exists to
    // remove: a pattern written with single quotes could never match a source whose
    // quotes had just been rewritten to double.
    const source = `const [mode, setMode] = useState<'cloud' | 'runtime'>('runtime');`;
    expect(sourceMatches(source, /useState<'cloud' \| 'runtime'>\('runtime'\)/)).toBe(true);
    expect(sourceMatches(source, /useState<"cloud" \| "runtime">\("runtime"\)/)).toBe(true);
    // A genuinely different value must still fail.
    expect(sourceMatches(source, /useState<'cloud' \| 'runtime'>\('cloud'\)/)).toBe(false);
  });

  it("applies every rule to the pattern as well as the source", () => {
    // This is the invariant that drifted three times when the rules lived in two
    // places: a rule applied to one side only turns a correct pattern into a failure.
    // Each case below is one of those regressions.
    const quoted = `const mode = 'select';`;
    expect(sourceMatches(quoted, /const mode = 'select'/)).toBe(true);

    const wrappedTag = `<UserControls\n  compact\n/>`;
    expect(sourceMatches(wrappedTag, /<UserControls compact \/>/)).toBe(true);

    const css = `transform: translate3d(var(--x), var(--y), 0);`;
    expect(sourceMatches(css, /translate3d\(var\(--x\), var\(--y\), 0\)/)).toBe(true);

    // And a pattern that genuinely does not describe the source still fails.
    expect(sourceMatches(css, /translate3d\(var\(--x\), var\(--z\), 0\)/)).toBe(false);
  });

  it("makes an unbounded gap span the whole file", () => {
    // Normalized source is one line, so `[^\n]*` and `[\s\S]*` no longer mean "nearby".
    // A pattern that relied on line boundaries will match across thousands of lines and
    // report a mechanism that is not there. Bound the gap explicitly instead.
    const source = `const [open, setOpen] = useState(false);\n${"// filler\n".repeat(50)}const expanded = true;`;
    expect(sourceMatches(source, /useState[^\n]*expanded/)).toBe(true);
    expect(sourceMatches(source, /useState.{0,40}expanded/)).toBe(false);
  });

  it("normalizes the wrapped and inline forms of one object to the same text", () => {
    // This is the property the whole module needs: two spellings of one value must
    // compare equal. Deleting the space after a comma broke it in one direction only,
    // so a pattern copied from the inline form could not match wrapped source.
    const wrapped = `const X = {\n    opacity: [1, 0.76, 0],\n    scale: [1, 0.56, 0.08],\n};`;
    const inline = `const X = { opacity: [1, 0.76, 0], scale: [1, 0.56, 0.08] };`;
    expect(normalizeSource(wrapped)).toBe(normalizeSource(inline));
    expect(sourceMatches(wrapped, /opacity: \[1, 0\.76, 0\], scale: \[1, 0\.56, 0\.08\]/)).toBe(true);
    // A different number must still fail.
    expect(sourceMatches(wrapped, /opacity: \[1, 0\.76, 0\], scale: \[1, 0\.56, 0\.09\]/)).toBe(false);
  });
});
