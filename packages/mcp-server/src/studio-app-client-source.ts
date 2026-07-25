import { readFileSync } from "node:fs";

export const studioAppClientSource = readFileSync(
  new URL("./studio-app-client.ts", import.meta.url),
  "utf8",
);
