import { WifiSlash } from "@phosphor-icons/react";

interface PendingAssetConnectionHintProps {
  compact?: boolean;
}

export function PendingAssetConnectionHint({
  compact = false,
}: PendingAssetConnectionHintProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        compact
          ? "flex items-center gap-2 text-amber-700 dark:text-amber-300"
          : "flex flex-col items-center gap-2 px-4 text-center text-amber-700 dark:text-amber-300"
      }
    >
      <WifiSlash size={compact ? 20 : 28} weight="duotone" />
      <div className={compact ? "leading-tight" : "space-y-0.5"}>
        <div className="text-xs font-semibold">Waiting for connection</div>
        <div className="text-[10px] opacity-80">
          Starts automatically after reconnection
        </div>
      </div>
    </div>
  );
}
