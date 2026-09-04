import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

process.env.CLASH_WEB_E2E_NO_CLOUDFLARE = "1";
process.env.CLASH_APP_NAME = "Clash Dev";
process.env.CLASH_PROFILE = "dev";
process.env.CLASH_DESKTOP_SOURCE_HOST_WATCH ??= "1";

const config: ForgeConfig = {
  packagerConfig: {},
  rebuildConfig: {},
  makers: [],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
