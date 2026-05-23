/**
 * CodeBlock — minimal version. Vercel's real one uses shiki for syntax
 * highlighting which would add ~2MB to the bundle. We render plain
 * preformatted text; if highlighting becomes important we can swap in
 * shiki at the leaves without touching call sites.
 */
import type { ComponentProps } from 'react';
import { cn } from './utils';

export interface CodeBlockProps extends Omit<ComponentProps<'pre'>, 'children'> {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language, className, ...props }: CodeBlockProps) {
  return (
    <pre
      data-language={language}
      className={cn(
        'm-0 max-h-72 overflow-auto whitespace-pre-wrap p-3 text-[11px] font-mono leading-relaxed text-foreground',
        className,
      )}
      {...props}
    >
      <code>{code}</code>
    </pre>
  );
}
