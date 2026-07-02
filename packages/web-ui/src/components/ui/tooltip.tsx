import type { ReactElement } from 'react';
import {
  Tooltip as AriakitTooltip,
  TooltipAnchor,
  TooltipProvider,
} from '@ariakit/react';

export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipProvider timeout={180}>
      <TooltipAnchor render={children} />
      <AriakitTooltip
        gutter={8}
        className="z-50 whitespace-nowrap rounded-md border border-warm-border bg-warm-surface px-2 py-1 text-xs font-medium text-stone-800 shadow-md"
      >
        {label}
      </AriakitTooltip>
    </TooltipProvider>
  );
}
