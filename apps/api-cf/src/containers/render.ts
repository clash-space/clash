import { Container } from "@cloudflare/containers";

export class RenderContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";

  override onStart() {
    console.log("[RenderContainer] Started");
  }

  override onStop() {
    console.log("[RenderContainer] Stopped");
  }

  override onError(error: unknown) {
    console.error("[RenderContainer] Error:", error);
  }
}
