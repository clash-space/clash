/**
 * Asset URL resolution.
 *
 * Converts R2 storage keys to proxy URLs: "uploads/xxx" → "/assets/uploads/xxx"
 * Passes through existing URLs (http, blob, data, /assets/) unchanged.
 */

export function isR2Key(src: string): boolean {
    if (typeof src !== 'string' || !src) return false;
    const s = src.trim();
    if (s.startsWith('http') || s.startsWith('blob:') || s.startsWith('data:') || s.startsWith('/')) return false;
    return s.startsWith('uploads/') || s.startsWith('projects/');
}

export function resolveAssetUrl(src: string): string {
    if (!src) return '';
    const s = src.trim();

    // Already a usable URL
    if (s.startsWith('http') || s.startsWith('blob:') || s.startsWith('data:') || s.startsWith('/')) return s;

    // Storage key → proxy URL
    if (isR2Key(s)) return `/assets/${s}`;

    return s;
}
