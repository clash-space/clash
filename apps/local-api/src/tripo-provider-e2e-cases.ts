import type { ProviderReplayTestCase } from "./provider-replay-test-harness.js";

const HUMANOID_T_POSE_PROMPT =
  "A single full-body bipedal humanoid character standing in a clean, symmetrical T-pose: "
  + "both arms fully extended straight out to the sides at shoulder height, palms facing down, "
  + "legs straight and feet shoulder-width apart, standing upright and facing forward, plain "
  + "neutral clothing, centered against a plain background, high clarity, no occlusion, no "
  + "cropping, only one figure in frame.";

/**
 * Two sequential live Tripo cases: a text-to-model humanoid T-pose generation, then an
 * auto-rig pass over that model's output. `tripo-auto-rig` carries no prompt of its own --
 * Tripo's rig endpoint takes only the source model -- and depends on `tripo-h31-humanoid`
 * through `refCaseIds` so the harness always runs and resolves it first.
 */
export async function createTripoProviderCases(): Promise<ProviderReplayTestCase[]> {
  return [
    {
      id: "tripo-h31-humanoid",
      type: "model_gen",
      modelId: "tripo-h3.1",
      prompt: HUMANOID_T_POSE_PROMPT,
      params: {
        pbr: true,
        textureQuality: "standard",
        geometryQuality: "standard",
        autoSize: false,
      },
      expect: { kind: "model", mediaType: "model/gltf-binary" },
    },
    {
      id: "tripo-auto-rig",
      type: "model_gen",
      modelId: "tripo-auto-rig",
      prompt: "",
      refCaseIds: ["tripo-h31-humanoid"],
      expect: { kind: "model", mediaType: "model/gltf-binary" },
    },
  ];
}

/**
 * Select costly live cases without changing the canonical order. Any requested id's
 * `refCaseIds` dependencies are pulled in automatically -- selecting `tripo-auto-rig` alone
 * still runs `tripo-h31-humanoid` first -- and the result always preserves the canonical
 * (dependency-first) order regardless of the order ids were requested in.
 */
export function selectTripoProviderCases(
  cases: readonly ProviderReplayTestCase[],
  targets: string | undefined,
): ProviderReplayTestCase[] {
  if (!targets?.trim()) return [...cases];
  const requested = [...new Set(targets.split(",").map((id) => id.trim()).filter(Boolean))];
  const byId = new Map(cases.map((candidate) => [candidate.id, candidate] as const));
  const unknown = requested.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown CLASH_PROVIDER_E2E_TARGETS: ${unknown.join(", ")}. `
        + `Expected one or more of: ${[...byId.keys()].join(", ")}`,
    );
  }

  const included = new Set<string>();
  const including = new Set<string>();
  function include(id: string): void {
    if (included.has(id)) return;
    if (including.has(id)) {
      throw new Error(`Tripo provider e2e cases have a refCaseIds cycle at ${id}`);
    }
    including.add(id);
    const candidate = byId.get(id)!;
    for (const dependencyId of candidate.refCaseIds ?? []) {
      if (!byId.has(dependencyId)) {
        throw new Error(
          `Tripo provider e2e case ${id} declares refCaseIds dependency ${dependencyId}, `
            + `which is not a known case id`,
        );
      }
      include(dependencyId);
    }
    including.delete(id);
    included.add(id);
  }
  for (const id of requested) include(id);

  // Filtering the canonical array (rather than emitting `included` insertion order) is what
  // guarantees dependency-first order even when a caller requests ids out of order.
  return cases.filter((candidate) => included.has(candidate.id));
}
