import { createConsola } from "consola";

const base = createConsola({ level: 3 });

function getCallerTag(): string {
  const stack = new Error().stack;
  if (!stack) return "unknown";
  const lines = stack.split("\n");
  for (const line of lines.slice(3)) {
    const match = line.match(/\/src\/(.+?)\.(ts|js)/);
    if (match) {
      const parts = match[1].split("/");
      return parts[parts.length - 1];
    }
  }
  return "unknown";
}

export const log = new Proxy(base, {
  get(target, prop, receiver) {
    if (prop === "error" || prop === "warn" || prop === "info" || prop === "debug") {
      const tag = getCallerTag();
      return (...args: any[]) => {
        const ts = new Date().toISOString();
        // Prepend timestamp to first arg if it's a string, otherwise inject as first arg
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
