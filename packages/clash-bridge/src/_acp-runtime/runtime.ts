/**
 * AcpRuntime — the only public factory. Holds a Spawner, hands out
 * AcpSessions. Callers don't talk to the spawner or the SDK directly.
 *
 * Restart policy is intentionally not implemented yet: the failure mode
 * for "agent crashed mid-tool-call" needs design work (ACP has no replay
 * primitive), and silently restarting risks confusing the model. Add
 * once the surface is real.
 */

import { AcpSessionImpl } from "./session.js";
import type { AcpRuntime, AcpSession, SessionOptions, Spawner } from "./types.js";

let nextId = 1;
const DEFAULT_INIT_TIMEOUT_MS = 120_000;

export class AcpRuntimeImpl implements AcpRuntime {
  #spawner: Spawner;

  constructor(spawner: Spawner) {
    this.#spawner = spawner;
  }

  async start(options: SessionOptions): Promise<AcpSession> {
    const child = await this.#spawner.spawn(options.agent);
    const id = `acp-${Date.now()}-${nextId++}`;
    const session = new AcpSessionImpl({ child, options, id });
    const initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    let initTimer: NodeJS.Timeout | undefined;
    const init = session.init();
    void init.catch(() => undefined);
    try {
      if (initTimeoutMs > 0) {
        await Promise.race([
          init,
          new Promise<never>((_, reject) => {
            initTimer = setTimeout(() => {
              reject(new Error(`ACP session init timed out after ${initTimeoutMs}ms`));
            }, initTimeoutMs);
            initTimer.unref?.();
          }),
        ]);
      } else {
        await init;
      }
    } catch (e) {
      // Init failed (handshake error, missing protocol version, child crashed
      // before responding, …). Kill the child so we don't leak the process.
      await session.dispose();
      throw e;
    } finally {
      if (initTimer) clearTimeout(initTimer);
    }
    return session;
  }
}
