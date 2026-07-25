import { readFileSync } from "node:fs";

export const canvasAppClientSource = readFileSync(
  new URL("./canvas-app-client.ts", import.meta.url),
  "utf8",
);
