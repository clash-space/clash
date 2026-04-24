/**
 * Short UUID Generation Utilities
 *
 * Provides utilities to generate short, unique IDs
 * like "abc123xy" for nodes and assets.
 * Generated locally without backend dependency.
 */

/**
 * Character set for short UUID generation
 * Uses lowercase letters and digits for readability
 */
const CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 8;

/**
 * Generate a short UUID locally
 * Creates an 8-character ID using lowercase letters and digits
 * Provides ~2.8 trillion possible combinations (36^8)
 *
 * @returns A short unique ID string
 */
function generateShortUUID(): string {
    const result: string[] = [];
    const randomValues = new Uint8Array(ID_LENGTH);

    // Use crypto.getRandomValues for better randomness
    crypto.getRandomValues(randomValues);

    for (let i = 0; i < ID_LENGTH; i++) {
        const index = randomValues[i] % CHARSET.length;
        result.push(CHARSET[index]);
    }

    return result.join('');
}

/**
 * Generate a single short unique ID
 * Project ID is kept for API compatibility but not used for generation
 *
 * @param _projectId - Project ID (not used, kept for compatibility)
 * @returns A short unique ID string
 */
export async function generateSemanticId(_projectId: string): Promise<string> {
    return generateShortUUID();
}

/**
 * Generate multiple short unique IDs
 * Project ID is kept for API compatibility but not used for generation
 *
 * @param _projectId - Project ID (not used, kept for compatibility)
 * @param count - Number of IDs to generate (default: 1)
 * @returns Array of generated short unique IDs
 */
export async function generateSemanticIds(_projectId: string, count: number = 1): Promise<string[]> {
    return Array.from({ length: count }, () => generateShortUUID());
}

/**
 * Cache for batched ID generation (kept for API compatibility)
 * Note: With local UUID generation, caching is no longer necessary
 * but this class is kept for backward compatibility
 */
class SemanticIdCache {
    async getId(projectId: string): Promise<string> {
        return generateSemanticId(projectId);
    }

    clear(_projectId?: string) {
        // No-op: local generation doesn't need cache clearing
    }
}

export const semanticIdCache = new SemanticIdCache();

/**
 * Get a semantic ID with caching
 * This is kept for API compatibility but delegates to direct generation
 *
 * @param projectId - Project ID for scoping
 * @returns A short unique ID string
 */
export async function getCachedSemanticId(projectId: string): Promise<string> {
    return semanticIdCache.getId(projectId);
}

