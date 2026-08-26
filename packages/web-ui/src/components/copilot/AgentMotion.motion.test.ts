import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { sourceMatches } from "../../test-support/source-match";

const css = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");

function keyframesBody(name: string) {
  expect(sourceMatches(css, new RegExp(`@keyframes ${name}`))).toBe(true);

  const marker = `@keyframes ${name}`;
  const markerIndex = css.indexOf(marker);
  const openIndex = css.indexOf("{", markerIndex);
  let depth = 0;

  for (let index = openIndex; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return css.slice(openIndex + 1, index);
  }

  throw new Error(`Missing closing brace for ${name}`);
}

function maximumTranslation(name: string) {
  const body = keyframesBody(name);
  const transforms = body.matchAll(
    /translate(?:(X|Y))?\(\s*(-?\d+(?:\.\d+)?)px(?:\s*,\s*(-?\d+(?:\.\d+)?)px)?\s*\)/g,
  );
  let maximum = 0;

  for (const transform of transforms) {
    const axis = transform[1];
    const first = Number(transform[2]);
    const second = Number(transform[3] ?? 0);
    const x = axis === "Y" ? 0 : first;
    const y = axis === "X" ? 0 : axis === "Y" ? first : second;
    maximum = Math.max(maximum, Math.hypot(x, y));
  }

  return maximum;
}

describe("AgentMotion choreography", () => {
  it("gives expressive states more body travel than the idle avatar", () => {
    const idle = maximumTranslation("clash-agent-idle-body");
    const waiting = maximumTranslation("clash-agent-waiting-body");
    const working = maximumTranslation("clash-agent-working-body");
    const failed = maximumTranslation("clash-agent-failed-shake");
    const review = maximumTranslation("clash-agent-review-body");

    expect(waiting).toBeGreaterThan(idle);
    expect(review).toBeGreaterThan(idle);
    expect(failed).toBeGreaterThan(idle);
    expect(working).toBeGreaterThan(waiting);
  });

  it("keeps amplified avatar motion visible outside the nominal icon box", () => {
    expect(
      sourceMatches(
        css,
        /\.clash-agent-motion\s*\{.{0,500}overflow:\s*visible/,
      ),
    ).toBe(true);
    expect(
      sourceMatches(
        css,
        /\.clash-agent-motion__svg\s*\{.{0,200}overflow:\s*visible/,
      ),
    ).toBe(true);
  });
});
