import type { ReactNode } from "react";
import { Microphone } from "@phosphor-icons/react";
import { Link } from "react-router";

import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { InlineAlert } from "../ui/feedback";

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
          className="w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden p-0"
        >
          <InlineAlert
            tone="error"
            title="Voice input unavailable"
            message={notice.message}
            icon={
              <Microphone
                className="h-4 w-4"
                weight="bold"
              />
            }
            action={
              notice.action ? (
                <PopoverClose asChild>
                  <Link
                    to={notice.action.href}
                    className="inline-flex text-xs font-semibold text-current underline underline-offset-2"
                  >
                    {notice.action.label}
                  </Link>
                </PopoverClose>
              ) : undefined
            }
            className="rounded-[inherit] border-0"
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
