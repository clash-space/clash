import { readFileSync } from "node:fs";

export const timelineAppClientSource = readFileSync(
  new URL("./app-client.ts", import.meta.url),
  "utf8",
);
