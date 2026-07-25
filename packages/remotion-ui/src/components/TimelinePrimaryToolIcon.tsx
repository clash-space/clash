import React from 'react';
import type { TimelineLibraryCategory } from '@clash/shared-types/timeline-library';

export type TimelinePrimaryToolIconId = 'media' | 'transcript' | TimelineLibraryCategory;

const iconClassName = 'h-[18px] w-[18px]';

export const TimelinePrimaryToolIcon: React.FC<{ tool: TimelinePrimaryToolIconId }> = ({ tool }) => {
  if (tool === 'media') {
    return (
      <svg data-timeline-tool-icon={tool} viewBox="0 0 24 24" className={iconClassName} aria-hidden="true">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="8.25" cy="9" r="1.35" fill="currentColor" />
        <path d="m5.5 17 4.2-4.2 2.6 2.4 2.15-2.15L18.5 17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (tool === 'sound-effects' || tool === 'audio-fx') {
    return (
      <svg data-timeline-tool-icon={tool} viewBox="0 0 24 24" className={iconClassName} aria-hidden="true">
        <path d="M9 18.2a3 3 0 1 1-2-2.83V7.1l10-2v10.1a3 3 0 1 1-2-2.83V8.1l-6 1.2z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (tool === 'text') {
    return (
      <svg data-timeline-tool-icon={tool} data-text-serif-icon="" viewBox="0 0 256 256" className={iconClassName} aria-hidden="true">
        <path d="M208 56v32a8 8 0 0 1-16 0V64h-56v128h24a8 8 0 0 1 0 16H96a8 8 0 0 1 0-16h24V64H64v24a8 8 0 0 1-16 0V56a8 8 0 0 1 8-8h144a8 8 0 0 1 8 8Z" fill="currentColor" />
      </svg>
    );
  }

  if (tool === 'stickers' || tool === 'motion-graphics') {
    return (
      <svg data-timeline-tool-icon={tool} data-graphics-layers-icon="" viewBox="0 0 24 24" className={iconClassName} aria-hidden="true">
        <path d="m12 4 8 4-8 4-8-4 8-4Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m4 12 8 4 8-4M4 16l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (tool === 'captions') {
    return (
      <svg data-timeline-tool-icon={tool} viewBox="0 0 24 24" className={iconClassName} aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="14" rx="2.25" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M6.75 13.25h4.5M13.25 13.25h4M6.75 16h3M11.25 16h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (tool === 'filters' || tool === 'luts' || tool === 'adjustments') {
    return (
      <svg data-timeline-tool-icon={tool} data-color-palette-icon="" viewBox="0 0 24 24" className={iconClassName} aria-hidden="true">
        <path d="M12 3.5a8.5 8.5 0 0 0 0 17h1.15a1.8 1.8 0 0 0 1.55-2.7l-.2-.35a1.8 1.8 0 0 1 1.55-2.7H18a2.5 2.5 0 0 0 2.5-2.5A8.6 8.6 0 0 0 12 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <circle cx="7.7" cy="10.2" r="1.15" fill="currentColor" />
        <circle cx="10.2" cy="6.9" r="1.15" fill="currentColor" />
        <circle cx="14.3" cy="7" r="1.15" fill="currentColor" />
        <circle cx="16.8" cy="10.3" r="1.15" fill="currentColor" />
      </svg>
    );
  }

  if (tool === 'transcript') {
    return (
      <svg data-timeline-tool-icon={tool} viewBox="0 0 24 24" className={iconClassName} aria-hidden="true">
        <path d="M6 4.5h9.5l2.5 2.75V19.5H6Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M15.5 4.75V7.5h2.25M9.25 10h5.5M9.25 13h5.5M9.25 16h3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (tool === 'transitions') {
    return (
      <svg data-timeline-tool-icon={tool} viewBox="0 0 24 24" className={iconClassName} aria-hidden="true">
        <path d="m4 6 6 6-6 6V6Zm16 0-6 6 6 6V6Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }

  if (tool === 'templates') {
    return (
      <svg data-timeline-tool-icon={tool} viewBox="0 0 24 24" className={iconClassName} aria-hidden="true">
        <rect x="4" y="4.5" width="16" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M4.5 9h15M9 9.5v9.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }

  return (
    <svg data-timeline-tool-icon={tool} data-effects-wand-icon="" viewBox="0 0 24 24" className={iconClassName} aria-hidden="true">
      <path d="m5 19 10.25-10.25 2 2L7 21l-2-2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 3.75v3.5M6.25 5.5h3.5M19 13.5v3M17.5 15h3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
};
