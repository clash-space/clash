/**
 * Unified Asset Status Machine
 *
 * Simple status machine for all AIGC assets (images, videos, etc.)
 * Both frontend and backend should use these exact values.
 *
 * Status Flow:
 * uploading -> generating -> completed
 *           \            \-> failed
 *            \-> completed (for direct uploads)
 */

// Canonical status values used by both frontend and backend.
// 'draft' = lazy placeholder for the unix-pipe flow: the user laid out a
// downstream node via the action-badge `+` flyout but hasn't run it yet.
// NodeProcessor ignores drafts — they transition to 'generating' only when
// adopted (Run / Run chain).
export type AssetStatus = 'draft' | 'uploading' | 'generating' | 'completed' | 'failed';

// Status descriptions for UI display
export const StatusDisplay: Record<AssetStatus, { label: string; description: string }> = {
  draft: {
    label: 'Draft',
    description: 'Not yet running — click Run to generate',
  },
  uploading: {
    label: 'Uploading',
    description: 'Asset is being uploaded',
  },
  generating: {
    label: 'Generating',
    description: 'Asset is being generated',
  },
  completed: {
    label: 'Completed',
    description: 'Generation finished successfully',
  },
  failed: {
    label: 'Failed',
    description: 'Generation failed',
  },
};

// Helper to check if status represents an "active" state (not final)
export function isActiveStatus(status: AssetStatus): boolean {
  return status === 'uploading' || status === 'generating';
}

// Helper to check if status represents a "final" state
export function isFinalStatus(status: AssetStatus): boolean {
  return status === 'completed' || status === 'failed';
}

// Normalize legacy/old status values to the new system
export function normalizeStatus(status: string | undefined): AssetStatus {
  if (!status) return 'generating';

  const statusLower = status.toLowerCase();

  // Draft / idle placeholder (unix-pipe draft)
  if (statusLower === 'draft' || statusLower === 'idle') {
    return 'draft';
  }

  // Uploading state
  if (statusLower === 'uploading') {
    return 'uploading';
  }

  // Legacy mappings - all "in progress" states become 'generating'
  if (['pending', 'processing', 'generating'].includes(statusLower)) {
    return 'generating';
  }

  // Error/failed states
  if (['error', 'failed'].includes(statusLower)) {
    return 'failed';
  }

  // Completed state (including legacy 'fin')
  if (statusLower === 'completed' || statusLower === 'fin') {
    return 'completed';
  }

  // Default to generating for unknown statuses
  return 'generating';
}
