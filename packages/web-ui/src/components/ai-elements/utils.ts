/**
 * Shared utilities for the ai-elements set. The whole point of this
 * directory is to mirror Vercel's AI SDK Elements visual language
 * without dragging in their full workspace (which depends on
 * mermaid / rive / katex / shiki). We re-implement just what
 * AcpMessageList needs.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
