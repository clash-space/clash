# Director Panorama Environment Product Contract

Status: Implemented and verified  
Owner: Director Stage  
Last updated: 2026-07-17

## Why this exists

Director Stage accepts ordinary 2:1 equirectangular images as 360-degree
environments. Those images describe the color seen in every direction from one
capture point. They do not, by themselves, describe room dimensions, metric
depth, floor scale, occlusion, or camera parallax.

The product previously treated a missing spatial volume as a `28 × 28 × 5.2 m`
room. That made an implementation preset look like truth inferred from the
image. A generic panorama cannot support that promise.

This contract separates image compatibility from spatial calibration so that:

- any valid 2:1 panorama works immediately;
- Clash never invents metric dimensions for a user asset;
- users can opt into a useful finite proxy when they know or choose the space;
- AI-generated environments preserve the setup that produced them;
- old and new scenes have one deterministic interpretation.

## Product promise

Clash supports two environment modes.

### Background sphere

Use a 2:1 equirectangular image as an infinitely distant visual background.

- This is the default for uploads and AI generation without an explicit size.
- Camera rotation is visually valid from the panorama capture origin.
- Camera translation does not produce panorama parallax.
- The 3D world remains unbounded.
- The Director grid is independent 3D geometry and is not promised to coincide
  with floor lines baked into the image.
- Users can calibrate heading, horizon, pitch, and roll.

### Calibrated finite space

Project the panorama onto an explicitly defined bounded proxy.

- This mode is enabled only by an explicit user choice or imported calibration.
- Presets are setup shortcuts, not image inference:
  - Compact studio: `12 × 12 × 3.6 m`
  - Standard stage: `28 × 28 × 5.2 m`
  - Large location: `60 × 60 × 12 m`
  - Custom: user-defined width, depth, and height
- The proxy controls panorama wall projection, finite grid extent, and the
  camera navigation calibration range.
- The proxy is a composition aid, not reconstructed scene geometry.
- Objects remain world-space objects. A proxy boundary must not silently delete,
  crop, or rescale them.

## Source-of-truth data model

Environment mode is derived from calibration metadata. It is not stored as a
second boolean or UI-only state.

```ts
environmentCalibration.workingVolume === undefined
  // Background sphere

environmentCalibration.workingVolume !== undefined
  // Calibrated finite space
```

`workingVolume` is optional and uses metres:

```ts
{
  mode: "bounded-box";
  preset: "compact" | "standard" | "large" | "custom";
  size: [width, height, depth];
  origin: [floorCenterX, floorY, floorCenterZ];
}
```

The surrounding calibration remains useful in both modes:

```ts
{
  projection: "equirectangular";
  capturePosition: [x, y, z];
  captureRotation: [pitch, yaw, roll];
  horizonV: number;
  forwardU: number;
  gridCellMeters: number;
  workingVolume?: WorkingVolume;
}
```

The scene's `environmentAssetId` references a normal project image asset.
Panorama images are not a special 3D asset format.

## Image compatibility

The baseline interchange contract is:

- projection: equirectangular;
- aspect ratio: exact `2:1`;
- full coverage: 360 degrees horizontal and 180 degrees vertical;
- common formats: PNG, JPEG, or WebP;
- seamless left and right edges;
- no assumption that pixel dimensions encode physical scale.

Photo Sphere orientation metadata may describe heading, pitch, roll, and crop.
It does not establish a metric room. Clash-specific finite calibration therefore
lives in Director metadata alongside the asset or scene binding.

## Setup experience

The Scene inspector presents one primary control:

```text
Environment mode
  Background sphere — Any 2:1 panorama, no spatial size
  Compact studio    — 12 × 12 × 3.6 m
  Standard stage    — 28 × 28 × 5.2 m
  Large location    — 60 × 60 × 12 m
  Custom space
```

Behavior:

1. A new stage starts in Background sphere mode.
2. Uploading a panorama without calibration preserves the current setup. Since
   the new-stage setup is Background sphere, ordinary uploads are spherical by
   default.
3. Selecting a finite preset writes `workingVolume` explicitly.
4. Selecting Background sphere removes `workingVolume` while preserving
   orientation calibration.
5. Custom dimensions appear only for Custom space.
6. Selecting an asset with embedded Director calibration restores that
   calibration. Selecting an uncalibrated asset preserves the setup the user
   explicitly chose for the stage.
7. The inspector explains the active guarantee:
   - Background sphere: distant backdrop, rotation-valid, no parallax.
   - Finite space: explicit proxy dimensions, not reconstructed geometry.

## AI panorama setup

AI generation uses the same environment mode as uploads.

- Background sphere generation requests a level 2:1 spherical environment but
  does not inject room dimensions.
- Finite-space generation includes the selected dimensions and capture height
  in the prompt.
- Reference-image generation keeps the exact target ratio.
- A calibration reference, when enabled, is passed as a normal reference image;
  it is not ControlNet, depth, or line conditioning.
- Generated output stores the active Director calibration even when the
  calibration reference is disabled, so reselecting the asset does not lose its
  setup.
- The generator must not draw calibration grids, axes, chroma lines, labels, or
  rulers into the final panorama.

### Generation-time mode awareness

Environment mode must remain visible throughout generation without interrupting
the user with a confirmation dialog.

1. Before generation, the AI panorama card exposes the same Environment mode
   selector as Scene properties.
2. Its setup summary names the active guarantee:
   - Background sphere: no physical size, rotation only, no translation
     parallax.
   - Finite space: exact width, depth, height, 1.6 m capture origin, and finite
     proxy projection.
3. The action and progress labels carry the target:
   - `Generate background panorama`
   - `Generate for 28 m stage`
   - `Generating background panorama…`
   - `Generating for 28 m stage…`
4. On success, Clash stores and displays a receipt for the setup used by that
   request, independent of later selector changes:
   - `Generated as Background sphere`, or
   - `Generated for Standard stage`
   - followed by `2:1 · 2048×1024 · calibration saved`.
5. Setup, progress, error, and receipt UI use existing Director semantic tokens;
   the 3D viewport remains the original dark production surface.

### Local development provider

The local `fal-mock` must honor explicit aspect ratios so Director Stage can
exercise the same validation path without pretending that a `16:9` placeholder
is a panorama.

- `aspect_ratio: "2:1"` produces a `1024 × 512` mock image.
- Director uniformly resamples that valid equirectangular input to
  `2048 × 1024` WebP.
- Unknown valid `a:b` ratios are derived from the ratio instead of silently
  falling back to `16:9`.
- Production validation still rejects non-2:1 output; Clash does not stretch or
  crop an invalid image into a spherical environment.

## Migration and compatibility

No schema-version bump is required because `workingVolume` is already optional.

- Existing scenes with an explicit `workingVolume` remain finite.
- Existing scenes without `workingVolume` become Background sphere.
- No scene is migrated to `28 m` merely because calibration exists.
- The standard preset remains available as an explicit one-click choice.
- Screenshot and video export consume the evaluated scene and require no format
  change.

## Success criteria

The implementation is complete when:

1. Missing `workingVolume` resolves to no finite volume.
2. Default calibration contains no `workingVolume`.
3. An explicit preset creates the expected bounded volume.
4. The viewport uses the background texture path and infinite grid when the
   volume is absent.
5. The viewport uses bounded projection, finite grid, and calibrated navigation
   when the volume is present.
6. Upload without embedded calibration defaults to Background sphere on a new
   stage.
7. AI generation persists the active calibration in both modes.
8. The UI exposes Background sphere before all finite presets and hides custom
   dimensions outside Custom space.
9. AI generation shows the active mode before and during generation, then
   reports the setup actually used by the successful request.
10. Existing explicit finite scenes render unchanged.
11. Automated tests, type checks, screenshot capture, and camera video export
    remain green.

## Out of scope

- Recovering metric geometry from a single panorama.
- Promising correct translation parallax for Background sphere.
- ControlNet, depth-map, or line-map generation pipelines.
- Coupling Clash metadata or rendering behavior to LibTV internals.
- Treating the finite proxy as collision geometry or a destructive world bound.

## Implementation map

- Product semantics and presets:
  `packages/director-core/src/index.ts`
- Background-sphere and bounded-proxy rendering:
  `packages/director-ui/src/DirectorViewport.tsx`
- Tokenized setup UI, upload behavior, and generation prompt:
  `packages/web-ui/src/components/ProjectDirectorStageSurface.tsx`
- AI reference/output calibration persistence:
  `packages/web-ui/src/components/ProjectEditor.tsx`
- Persisted calibration schema:
  `packages/shared-types/src/director-stage.ts`

## Verification snapshot

Verified on 2026-07-17:

- 55 focused Director, panorama, schema, and video-export tests passed.
- Local provider tests confirm exact `2:1` mock generation and preserve the
  existing fal queue/media contract.
- Shared types built successfully.
- Director core, Director UI, Web UI, CLI, and Desktop type checks passed.
- Agent-browser WebGL validation switched an existing scene from explicit
  Standard stage to Background sphere and back without losing the finite setup.
- A real 16:9 shot was registered.
- A real VP9 camera export rendered at `1920 × 1080` through `9.944 s`, including
  the panorama and Director grid in the sampled frame.
- A live Standard stage generation completed through the local provider,
  normalized from `1024 × 512` to `2048 × 1024`, persisted calibration, and
  displayed the finite-space success receipt.

## Standards references

- [Google Photo Sphere XMP](https://developers.google.com/streetview/spherical-metadata)
  defines equirectangular projection, orientation, and crop/display metadata.
- [Three.js Scene background](https://threejs.org/docs/pages/Scene.html)
  accepts equirectangular textures as scene backgrounds and exposes background
  rotation independently of world geometry.
