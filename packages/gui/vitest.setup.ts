import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "@testing-library/jest-dom/vitest";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."));
