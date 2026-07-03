import type { ReactElement, ReactNode } from 'react';
import {
  Tooltip as AriakitTooltip,
  TooltipAnchor,
  TooltipProvider,
} from '@ariakit/react';

export function Tooltip({ label, children }: { label: ReactNode; children: ReactElement }) {
  return (
    <TooltipProvider timeout={180}>
      <TooltipAnchor render={children} />
      <AriakitTooltip
        gutter={8}
        style={{
          zIndex: 999999,
          whiteSpace: 'nowrap',
          borderRadius: 6,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          backgroundColor: '#111111',
          color: '#ffffff',
          padding: '6px 10px',
          fontSize: 12,
          fontWeight: 700,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
          pointerEvents: 'none',
        }}
      >
        {label}
      </AriakitTooltip>
    </TooltipProvider>
  );
}
