export type DesktopStartupDecision = "retry" | "quit";
export type DesktopStartupOutcome = "started" | "quit";

export async function startDesktopWithRecovery({
  start,
  decide,
  quit,
}: {
  start: () => Promise<void>;
  decide: (error: unknown) => Promise<DesktopStartupDecision>;
  quit: () => void;
}): Promise<DesktopStartupOutcome> {
  for (;;) {
    try {
      await start();
      return "started";
    } catch (error) {
      if ((await decide(error)) === "retry") continue;
      quit();
      return "quit";
    }
  }
}
