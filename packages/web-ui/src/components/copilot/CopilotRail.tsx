import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../ai-elements/utils';

export const COPILOT_RAIL_SLOT_CLASS =
  'clash-copilot-rail-slot flex h-8 w-8 shrink-0 -translate-x-1 items-center justify-center';

export function CopilotRailSlot({
  children,
  className,
  ariaHidden = true,
  ...props
}: {
  children: ReactNode;
  className?: string;
  ariaHidden?: boolean;
} & Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'className' | 'aria-hidden'>) {
  return (
    <span
      {...props}
      data-copilot-rail-slot
      className={cn(COPILOT_RAIL_SLOT_CLASS, className)}
      aria-hidden={ariaHidden}
    >
      {children}
    </span>
  );
}
