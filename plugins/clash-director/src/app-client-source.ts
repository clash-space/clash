import { readFileSync } from "node:fs";

export const directorAppClientSource = readFileSync(
  new URL("./app-client.ts", import.meta.url),
  "utf8",
);
