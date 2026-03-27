import { createConsola } from "consola";

const base = createConsola({ level: 3 });

function getCallerTag(): string {
  const stack = new Error().stack;
  if (!stack) return "app";
  const lines = stack.split("\n");
  for (const line of lines.slice(3)) {
    // Match both source (/src/foo/bar.ts) and bundled paths (foo/bar.js)
    const match = line.match(/\/([\w-]+)\.(ts|js)/);
    if (match) {
      const name = match[1];
      // Skip internal/generic names
      if (["index", "chunk", "bundle", "worker", "logger"].includes(name)) continue;
      return name;
    }
  }
  return "app";
}

export const log = new Proxy(base, {
  get(target, prop, receiver) {
    if (prop === "error" || prop === "warn" || prop === "info" || prop === "debug") {
      const tag = getCallerTag();
      return (...args: any[]) => {
        const ts = new Date().toISOString();
        if (typeof args[0] === "string") {
          args[0] = `${ts} ${args[0]}`;
        } else {
          args.unshift(ts);
        }
        (target.withTag(tag) as any)[prop](...args);
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});
