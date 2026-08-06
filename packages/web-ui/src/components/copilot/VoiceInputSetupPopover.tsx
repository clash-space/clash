import type { ReactNode } from "react";
import { Microphone } from "@phosphor-icons/react";
import { Link } from "react-router";

import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";

export interface VoiceInputNotice {
  message: string;
  action?: {
    label: string;
    href: string;
  };
}

interface VoiceInputSetupPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notice: VoiceInputNotice | null;
  trigger: ReactNode;
}

/**
 * The single product surface for microphone setup failures.
 *
 * Radix owns trigger toggling, focus, Escape, outside-click dismissal,
 * collision handling, and portal placement. Callers only provide the
 * asynchronous voice readiness result.
 */
export function VoiceInputSetupPopover({
  open,
  onOpenChange,
  notice,
  trigger,
}: VoiceInputSetupPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {notice ? (
        <PopoverContent
          role="dialog"
          aria-label="Voice input setup"
          side="top"
          align="end"
          sideOffset={8}
          className="w-[min(20rem,calc(100vw-1.5rem))] p-3"
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warm-muted text-content-secondary">
              <Microphone
                className="h-4 w-4"
                weight="bold"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-content-primary">
                Voice input unavailable
              </p>
              <p
                role="alert"
                className="mt-1 text-xs leading-5 text-content-secondary"
              >
                {notice.message}
              </p>
              {notice.action ? (
                <PopoverClose asChild>
                  <Link
                    to={notice.action.href}
                    className="mt-2 inline-flex text-xs font-semibold text-brand underline-offset-2 hover:underline"
                  >
                    {notice.action.label}
                  </Link>
                </PopoverClose>
              ) : null}
            </div>
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
