import type { Env as AppEnv } from "../config";

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS?: unknown;
    }
  }
}

export {};
