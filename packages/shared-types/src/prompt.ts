/**
 * Mixed-modality prompt parsing and serialization.
 *
 * Prompts are stored as markdown with @-mention syntax for inline asset references:
 *   "Create posters for this @[Eyewear](node:img-abc123) brand."
 *
 * Syntax: @[Label](node:nodeId)
 *
 * At execution time, the prompt is parsed into parts (text + asset refs),
 * and assets are resolved to URLs for the generation API.
 */

/** A single part of a mixed-modality prompt */
export interface PromptPart {
  type: 'text' | 'asset_ref';
  /** Text content (for type='text') */
  text?: string;
  /** Referenced canvas node ID (for type='asset_ref') */
  nodeId?: string;
  /** Display label of the referenced asset */
  label?: string;
}

/** An extracted asset reference from a prompt */
export interface AssetRef {
  nodeId: string;
  label: string;
}

// Regex to match @[Label](node:nodeId) — text mention format
const TEXT_MENTION_REGEX = /@\[([^\]]*)\]\(node:([^)]+)\)/g;

// Regex to match ![mention:nodeId:label](url) — Milkdown image node mention format
const IMAGE_MENTION_REGEX = /!\[mention:([^:\]]+):([^\]]*)\]\([^)]*\)/g;

// Combined regex for hasAssetMentions (either format)
const MENTION_REGEX = /(?:@\[([^\]]*)\]\(node:([^)]+)\)|!\[mention:([^:\]]+):([^\]]*)\]\([^)]*\))/g;

/**
 * Parse a markdown prompt with @-mentions into a sequence of parts.
 * Handles both text mention format (@[Label](node:nodeId)) and
 * Milkdown image mention format (![mention:nodeId:label](url)).
 *
 * @example
 * parsePromptParts("Create posters for @[Eyewear](node:abc) brand")
 * // → [
 * //   { type: 'text', text: 'Create posters for ' },
 * //   { type: 'asset_ref', nodeId: 'abc', label: 'Eyewear' },
 * //   { type: 'text', text: ' brand' },
 * // ]
 */
export function parsePromptParts(markdown: string): PromptPart[] {
  if (!markdown) return [];

  // Collect all matches from both formats, sorted by position
  const allMatches: Array<{ index: number; length: number; nodeId: string; label: string }> = [];

  TEXT_MENTION_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEXT_MENTION_REGEX.exec(markdown)) !== null) {
    allMatches.push({ index: m.index, length: m[0].length, label: m[1], nodeId: m[2] });
  }

  IMAGE_MENTION_REGEX.lastIndex = 0;
  while ((m = IMAGE_MENTION_REGEX.exec(markdown)) !== null) {
    allMatches.push({ index: m.index, length: m[0].length, nodeId: m[1], label: m[2] });
  }

  allMatches.sort((a, b) => a.index - b.index);

  const parts: PromptPart[] = [];
  let lastIndex = 0;

  for (const match of allMatches) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: markdown.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'asset_ref', label: match.label, nodeId: match.nodeId });
    lastIndex = match.index + match.length;
  }

  if (lastIndex < markdown.length) {
    parts.push({ type: 'text', text: markdown.slice(lastIndex) });
  }

  if (parts.length === 0 && markdown.length > 0) {
    parts.push({ type: 'text', text: markdown });
  }

  return parts;
}

/**
 * Extract just the text content from prompt parts.
 * Asset references are replaced with their label text so the prompt
 * reads naturally for models that only accept text.
 *
 * @example
 * extractPromptText(parts) // → "Create posters for Eyewear brand"
 */
export function extractPromptText(parts: PromptPart[]): string {
  return parts
    .map((p) => (p.type === 'text' ? p.text : p.label) ?? '')
    .join('');
}

const DEFAULT_PROMPT_PLACEHOLDERS = new Set([
  '# Prompt\nEnter your prompt here...',
  '# Prompt\n\nEnter your prompt here...',
]);

export function normalizePromptInput(value: string | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  return DEFAULT_PROMPT_PLACEHOLDERS.has(trimmed) ? '' : value;
}

export function composePromptWithTextRefs(prompt: string, textRefs: ReadonlyArray<string>): string {
  const cleanPrompt = normalizePromptInput(prompt).trim();
  const refs = textRefs
    .map((ref) => normalizePromptInput(ref).trim())
    .filter(Boolean);
  return [cleanPrompt, ...refs].filter(Boolean).join('\n\n');
}

/**
 * Extract all asset references from prompt parts.
 */
export function extractAssetRefs(parts: PromptPart[]): AssetRef[] {
  return parts
    .filter((p): p is PromptPart & { type: 'asset_ref'; nodeId: string; label: string } =>
      p.type === 'asset_ref' && !!p.nodeId
    )
    .map((p) => ({ nodeId: p.nodeId, label: p.label }));
}

/**
 * Build the @-mention markdown syntax for a given asset.
 *
 * @example
 * buildMention("Eyewear", "img-abc123") // → "@[Eyewear](node:img-abc123)"
 */
export function buildMention(label: string, nodeId: string): string {
  return `@[${label}](node:${nodeId})`;
}

/**
 * Check if a prompt string contains any @-mention references (either format).
 */
export function hasAssetMentions(markdown: string): boolean {
  MENTION_REGEX.lastIndex = 0;
  return MENTION_REGEX.test(markdown);
}
