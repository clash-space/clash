import { describe, expect, it } from "vitest";

import { MODEL_CARDS } from "./models.js";

describe("Volcengine Seedance Asset delivery", () => {
  it("requires a public URL for video and permits byte fallback for smaller references", () => {
    const routes = MODEL_CARDS.flatMap((model) =>
      (model.providerImplementations ?? [])
        .filter(
          (route) =>
            route.providerId === "volcengine-modelark" &&
            route.apiShape === "modelark" &&
            model.id.startsWith("seedance-"),
        )
        .map((route) => ({ model, route })),
    );

    expect(routes.length).toBeGreaterThan(0);
    for (const { model, route } of routes) {
      const deliveryFor = (kind: "image" | "video" | "audio") =>
        route.assetInputs?.find((delivery) =>
          !delivery.match.kinds?.length || delivery.match.kinds.includes(kind),
        );
      const inputMode = model.input.inputMode;

      if (inputMode.videos) {
        expect(deliveryFor("video"), model.id).toMatchObject({
          representations: ["provider-url"],
        });
      } else {
        expect(deliveryFor("video"), model.id).toBeUndefined();
      }
      if (inputMode.images || inputMode.startEnd) {
        expect(deliveryFor("image"), model.id).toMatchObject({
          representations: ["bytes"],
        });
      } else {
        expect(deliveryFor("image"), model.id).toBeUndefined();
      }
      if (inputMode.audios) {
        expect(deliveryFor("audio"), model.id).toMatchObject({
          representations: ["bytes"],
        });
      } else {
        expect(deliveryFor("audio"), model.id).toBeUndefined();
      }
    }
  });
});
