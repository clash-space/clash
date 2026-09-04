import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const desktopRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: resolve(desktopRoot, "dist"),
    emptyOutDir: false,
    sourcemap: true,
    ssr: resolve(desktopRoot, "src/preload.ts"),
    rollupOptions: {
      input: { preload: resolve(desktopRoot, "src/preload.ts") },
      external: ["electron"],
      output: {
        format: "cjs",
        entryFileNames: "[name].cjs",
        inlineDynamicImports: true,
      },
    },
  },
});
