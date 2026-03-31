/**
 * @clash/action-sdk — Types for building Clash canvas actions.
 *
 * Action authors import these types to build CF Workers that handle
 * canvas action execution.
 *
 * @example
 * ```typescript
 * import type { ActionRequest, ActionResponse } from '@clash/action-sdk';
 *
 * export default {
 *   async fetch(request: Request): Promise<Response> {
 *     const req: ActionRequest = await request.json();
 *     // ... process action ...
 *     return Response.json({ type: 'image', url: '...' } satisfies ActionResponse);
 *   }
 * };
 * ```
 */

// ─── Request (sent by platform to action worker) ─────────

export interface ActionInputNode {
  id: string;
  type: string;
  /** R2 storage key or public URL for image/video nodes */
  src?: string;
  /** Text content for text nodes */
  content?: string;
  /** Node label */
  label?: string;
}

export interface ActionRequest {
  /** Unique task ID for this execution */
  taskId: string;
  /** Canvas node ID that triggered this action */
  nodeId: string;
  /** Project ID */
  projectId: string;
  /** Action ID (matches action.json `id` field) */
  actionId: string;
  /** User's prompt text from the action-badge node */
  prompt: string;
  /** User-configured parameters (defined in action.json `parameters`) */
  params: Record<string, unknown>;
  /** Platform-injected secrets (decrypted user variables matching action.json `secrets`) */
  secrets: Record<string, string>;
  /** Connected upstream nodes (images, text, etc.) */
  inputNodes?: ActionInputNode[];
}

// ─── Response (returned by action worker to platform) ─────

export interface ActionResponse {
  /** Output type — determines what canvas node is created */
  type: "image" | "video" | "text";
  /** URL to download the result (for image/video). Platform will fetch + store in R2. */
  url?: string;
  /** Text content (for type='text' output) */
  content?: string;
  /** MIME type of the result */
  mimeType?: string;
  /** Human-readable description of the result */
  description?: string;
  /** Error message if the action failed */
  error?: string;
}

// ─── Action Manifest (action.json) ────────────────────────

export interface ActionManifestParameter {
  id: string;
  label: string;
  type: "text" | "number" | "slider" | "select" | "boolean";
  description?: string;
  defaultValue?: string | number | boolean;
  options?: Array<{ label: string; value: string | number }>;
  min?: number;
  max?: number;
  step?: number;
}

export interface ActionManifestSecret {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface ActionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  repository?: string;
  outputType: "image" | "video" | "text";
  parameters?: ActionManifestParameter[];
  secrets?: ActionManifestSecret[];
  runtime: "local" | "worker";
  workerUrl?: string;
  icon?: string;
  color?: string;
  tags?: string[];
}
