export interface DirectorRenderedFrame {
  timeSeconds: number;
  canvas: HTMLCanvasElement;
}

export interface DirectorWebGlRendererLike {
  render(scene: unknown, camera: unknown): void;
}

export function createDirectorFramePublicationGate(requiredStableFrames = 8): {
  tick(resourcesActive: boolean): boolean;
  reset(): void;
} {
  if (!Number.isInteger(requiredStableFrames) || requiredStableFrames < 1) {
    throw new Error("Director frame publication requires a positive stable-frame count");
  }
  let stableFrames = 0;
  let published = false;
  return {
    tick(resourcesActive) {
      if (published) return false;
      if (resourcesActive) {
        stableFrames = 0;
        return false;
      }
      stableFrames += 1;
      if (stableFrames < requiredStableFrames) return false;
      published = true;
      return true;
    },
    reset() {
      stableFrames = 0;
      published = false;
    },
  };
}

/**
 * Shared completion boundary for interactive and headless Director rendering.
 * A frame is publishable only after the same Three renderer used by the
 * DirectorViewport has drawn the evaluated scene into its product canvas.
 */
export function renderDirectorFrameNow(input: {
  renderer: DirectorWebGlRendererLike;
  scene: unknown;
  camera: unknown;
  timeSeconds: number;
  canvas: HTMLCanvasElement;
  publish: (frame: DirectorRenderedFrame) => void;
}): void {
  input.renderer.render(input.scene, input.camera);
  input.publish({ timeSeconds: input.timeSeconds, canvas: input.canvas });
}
