import { AcpSessionImpl } from "./session.js";
import type {
  AcpRuntime,
  AcpSession,
  SessionOptions,
  Spawner,
} from "./types.js";

let nextId = 1;
const DEFAULT_INIT_TIMEOUT_MS = 120_000;

export class AcpRuntimeImpl implements AcpRuntime {
  readonly #spawner: Spawner;

  constructor(spawner: Spawner) {
    this.#spawner = spawner;
  }

  async start(options: SessionOptions): Promise<AcpSession> {
    const startedAt = Date.now();
    const id = `acp-${startedAt}-${nextId++}`;
    const child = await this.#spawner.spawn(options.agent);
    const session = new AcpSessionImpl({ child, options, id });
    const initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    const init = session.init();
    void init.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (initTimeoutMs > 0) {
        await Promise.race([
          init,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`ACP session init timed out after ${initTimeoutMs}ms`));
            }, initTimeoutMs);
            timer.unref?.();
          }),
        ]);
      } else {
        await init;
      }
      if (process.env.NODE_ENV !== "test") {
        process.stderr.write(
          `[acp-runtime] id=${id} command=${options.agent.command} total_ms=${Date.now() - startedAt}\n`,
        );
      }
    } catch (error) {
      await session.dispose();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    return session as AcpSession;
  }
}
