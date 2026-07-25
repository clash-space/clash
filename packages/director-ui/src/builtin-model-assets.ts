import type {
  DirectorStageActionName,
  DirectorStageTransform,
} from "@clash/shared-types";

export type DirectorBuiltinModelCategory =
  | "Characters"
  | "Animals"
  | "Furniture"
  | "Props"
  | "Vehicles"
  | "Nature";

export interface DirectorBuiltinModelRig {
  profileId?: "clash-humanoid-v1" | "clash-quadruped-v1";
  jointCount: number;
  clipNames: readonly string[];
  actionMap: Readonly<Partial<Record<DirectorStageActionName, string>>>;
}

export interface DirectorBuiltinModelAsset {
  id: string;
  name: string;
  category: DirectorBuiltinModelCategory;
  description: string;
  sourceName: "Poly Haven" | "Quaternius";
  sourcePageUrl: string;
  license: "CC0-1.0";
  licenseUrl: string;
  sourceSha256: string;
  animated: boolean;
  rig?: DirectorBuiltinModelRig;
  sourceUrl: string;
  thumbnailUrl: string;
  defaultTransform: DirectorStageTransform;
}

const identityTransform = (): DirectorStageTransform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

const uniformScaleTransform = (scale: number): DirectorStageTransform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [scale, scale, scale],
});

export const DIRECTOR_BUILTIN_MODEL_ASSETS: readonly DirectorBuiltinModelAsset[] = [
  {
    id: "builtin:quaternius:casual-hoodie",
    name: "Casual character",
    category: "Characters",
    description: "Rigged humanoid with authored clothing and embedded animation clips.",
    sourceName: "Quaternius",
    sourcePageUrl: "https://quaternius.com/packs/ultimatemodularcharacters.html",
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceSha256: "dd74886c26998a0fa888b4ce557a0932d7d97b0265dd4c763154d081b7a6cb98",
    animated: true,
    rig: {
      profileId: "clash-humanoid-v1",
      jointCount: 62,
      clipNames: [
        "Death", "Gun_Shoot", "HitRecieve", "HitRecieve_2", "Idle",
        "Idle_Gun", "Idle_Gun_Pointing", "Idle_Gun_Shoot", "Idle_Neutral",
        "Idle_Sword", "Interact", "Kick_Left", "Kick_Right", "Punch_Left",
        "Punch_Right", "Roll", "Run", "Run_Back", "Run_Left", "Run_Right",
        "Run_Shoot", "Sword_Slash", "Walk", "Wave",
      ],
      actionMap: {
        idle: "Idle_Neutral",
        walk: "Walk",
        run: "Run",
        wave: "Wave",
        interact: "Interact",
      },
    },
    sourceUrl: new URL("../assets/starter-library/models/Casual_Hoodie.gltf", import.meta.url).href,
    thumbnailUrl: new URL("../assets/starter-library/thumbnails/Casual_Hoodie.jpg", import.meta.url).href,
    defaultTransform: identityTransform(),
  },
  {
    id: "builtin:quaternius:animated-horse",
    name: "Animated horse",
    category: "Animals",
    description: "Rigged horse with walk, trot, gallop, jump, attack, and idle clips.",
    sourceName: "Quaternius",
    sourcePageUrl: "https://quaternius.com/packs/ultimateanimatedanimals.html",
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceSha256: "3deb61550dff1d2786d04b6e8559d63ad3907d6ab606ba28ce0af074ed96341b",
    animated: true,
    rig: {
      profileId: "clash-quadruped-v1",
      jointCount: 50,
      clipNames: [
        "Attack_Headbutt", "Attack_Kick", "Death", "Eating", "Gallop",
        "Gallop_Jump", "Idle", "Idle_2", "Idle_Headlow", "Idle_HitReact1",
        "Idle_HitReact2", "Jump_toIdle", "Walk",
      ],
      actionMap: {
        idle: "Idle",
        walk: "Walk",
        run: "Gallop",
      },
    },
    sourceUrl: new URL("../assets/starter-library/models/Horse.gltf", import.meta.url).href,
    thumbnailUrl: new URL("../assets/starter-library/thumbnails/Horse.jpg", import.meta.url).href,
    defaultTransform: uniformScaleTransform(0.5),
  },
  {
    id: "builtin:polyhaven:arm-chair-01",
    name: "Victorian armchair",
    category: "Furniture",
    description: "Carved varnished wood armchair with worn fabric upholstery.",
    sourceName: "Poly Haven",
    sourcePageUrl: "https://polyhaven.com/a/ArmChair_01",
    license: "CC0-1.0",
    licenseUrl: "https://polyhaven.com/license",
    sourceSha256: "cc7a4829c0208303b56d0ae9a3a39a51241e0b281b775fb305cb9bfffbc14949",
    animated: false,
    sourceUrl: new URL("../assets/starter-library/models/ArmChair_01.glb", import.meta.url).href,
    thumbnailUrl: new URL("../assets/starter-library/thumbnails/ArmChair_01.png", import.meta.url).href,
    defaultTransform: identityTransform(),
  },
  {
    id: "builtin:polyhaven:wooden-table-02",
    name: "Worn wooden table",
    category: "Furniture",
    description: "Human-scale wooden table with PBR grain, wear, and edge detail.",
    sourceName: "Poly Haven",
    sourcePageUrl: "https://polyhaven.com/a/WoodenTable_02",
    license: "CC0-1.0",
    licenseUrl: "https://polyhaven.com/license",
    sourceSha256: "0a18eb4d6143e877c6b69918b68a9dae54f0b3c68318973d7d70f25211f825ce",
    animated: false,
    sourceUrl: new URL("../assets/starter-library/models/WoodenTable_02.glb", import.meta.url).href,
    thumbnailUrl: new URL("../assets/starter-library/thumbnails/WoodenTable_02.png", import.meta.url).href,
    defaultTransform: identityTransform(),
  },
  {
    id: "builtin:polyhaven:sofa-01",
    name: "Vintage sofa",
    category: "Furniture",
    description: "Authored two-seat sofa with carved wood and upholstered cushions.",
    sourceName: "Poly Haven",
    sourcePageUrl: "https://polyhaven.com/a/Sofa_01",
    license: "CC0-1.0",
    licenseUrl: "https://polyhaven.com/license",
    sourceSha256: "fb320c4c900465177f7ec07d7ee4723ac694b5d5ca3206d18b9b554d9a9a18c2",
    animated: false,
    sourceUrl: new URL("../assets/starter-library/models/Sofa_01.glb", import.meta.url).href,
    thumbnailUrl: new URL("../assets/starter-library/thumbnails/Sofa_01.png", import.meta.url).href,
    defaultTransform: identityTransform(),
  },
  {
    id: "builtin:polyhaven:barrel-01",
    name: "Industrial barrel",
    category: "Props",
    description: "Painted metal barrel with realistic edge wear and PBR surface detail.",
    sourceName: "Poly Haven",
    sourcePageUrl: "https://polyhaven.com/a/Barrel_01",
    license: "CC0-1.0",
    licenseUrl: "https://polyhaven.com/license",
    sourceSha256: "42926dfd352501d152fe2d097e039cb4c03381925369fa71a382019cffefbe9f",
    animated: false,
    sourceUrl: new URL("../assets/starter-library/models/Barrel_01.glb", import.meta.url).href,
    thumbnailUrl: new URL("../assets/starter-library/thumbnails/Barrel_01.png", import.meta.url).href,
    defaultTransform: identityTransform(),
  },
  {
    id: "builtin:polyhaven:lantern-01",
    name: "Vintage lantern",
    category: "Props",
    description: "Metal and glass hurricane lantern with production-ready PBR materials.",
    sourceName: "Poly Haven",
    sourcePageUrl: "https://polyhaven.com/a/Lantern_01",
    license: "CC0-1.0",
    licenseUrl: "https://polyhaven.com/license",
    sourceSha256: "618ceb2ec11bcaeb69c7b80511499f90a37e10ef612db8ee5edd11e863c8f04c",
    animated: false,
    sourceUrl: new URL("../assets/starter-library/models/Lantern_01.glb", import.meta.url).href,
    thumbnailUrl: new URL("../assets/starter-library/thumbnails/Lantern_01.png", import.meta.url).href,
    defaultTransform: identityTransform(),
  },
  {
    id: "builtin:polyhaven:covered-car",
    name: "Covered car",
    category: "Vehicles",
    description: "Full-size vehicle silhouette under a weathered fabric cover.",
    sourceName: "Poly Haven",
    sourcePageUrl: "https://polyhaven.com/a/covered_car",
    license: "CC0-1.0",
    licenseUrl: "https://polyhaven.com/license",
    sourceSha256: "5fb0d544af53bd435bcad303ebeb91db7f848d8a3995b994ec83be3527b98828",
    animated: false,
    sourceUrl: new URL("../assets/starter-library/models/covered_car.glb", import.meta.url).href,
    thumbnailUrl: new URL("../assets/starter-library/thumbnails/covered_car.png", import.meta.url).href,
    defaultTransform: identityTransform(),
  },
  {
    id: "builtin:polyhaven:boulder-01",
    name: "Mossy boulder",
    category: "Nature",
    description: "Scanned boulder with lichen, layered rock, and natural weathering.",
    sourceName: "Poly Haven",
    sourcePageUrl: "https://polyhaven.com/a/boulder_01",
    license: "CC0-1.0",
    licenseUrl: "https://polyhaven.com/license",
    sourceSha256: "136c64c1aca6c03593d4c25d4ee08291a4360145326c885f1c3d0a5d852f1bbf",
    animated: false,
    sourceUrl: new URL("../assets/starter-library/models/boulder_01.glb", import.meta.url).href,
    thumbnailUrl: new URL("../assets/starter-library/thumbnails/boulder_01.png", import.meta.url).href,
    defaultTransform: identityTransform(),
  },
  {
    id: "builtin:polyhaven:anthurium-botany-01",
    name: "Anthurium plant",
    category: "Nature",
    description: "Detailed broad-leaf tropical plant for interior and exterior staging.",
    sourceName: "Poly Haven",
    sourcePageUrl: "https://polyhaven.com/a/anthurium_botany_01",
    license: "CC0-1.0",
    licenseUrl: "https://polyhaven.com/license",
    sourceSha256: "554d459d21615da5f806cc9bdfe427f7a96fe9802da40a9a82a5461f6f659e6d",
    animated: false,
    sourceUrl: new URL("../assets/starter-library/models/anthurium_botany_01.glb", import.meta.url).href,
    thumbnailUrl: new URL("../assets/starter-library/thumbnails/anthurium_botany_01.png", import.meta.url).href,
    defaultTransform: identityTransform(),
  },
] as const;

export const DIRECTOR_BUILTIN_MODEL_ASSET_URLS: Readonly<Record<string, string>> =
  Object.fromEntries(
    DIRECTOR_BUILTIN_MODEL_ASSETS.map((asset) => [asset.id, asset.sourceUrl]),
  );
