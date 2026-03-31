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

// Regex to match @[Label](node:nodeId)
const MENTION_REGEX = /@\[([^\]]*)\]\(node:([^)]+)\)/g;

/**
 * Parse a markdown prompt with @-mentions into a sequence of parts.
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

  const parts: PromptPart[] = [];
  let lastIndex = 0;

  // Reset regex state
  MENTION_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(markdown)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: markdown.slice(lastIndex, match.index) });
    }

    // Add the asset reference
    parts.push({
      type: 'asset_ref',
      label: match[1],
      nodeId: match[2],
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < markdown.length) {
    parts.push({ type: 'text', text: markdown.slice(lastIndex) });
  }

  // If no matches at all, return entire string as single text part
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
 * Check if a prompt string contains any @-mention references.
 */
export function hasAssetMentions(markdown: string): boolean {
  MENTION_REGEX.lastIndex = 0;
  return MENTION_REGEX.test(markdown);
}
