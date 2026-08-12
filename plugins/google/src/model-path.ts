/**
 * The full address of a model, on either Google.
 *
 * `googleBaseUrl` returns a host with its API version already on it, and the old `modelPath`
 * appended a second one -- so an Agent Platform account asked for `/v1/v1/publishers/...`, and
 * Google answered 404 with an empty body, which the plugin reported as a non-JSON response.
 *
 * The two services also do not share a path shape. AI Studio addresses a model globally. Agent
 * Platform addresses it inside a project and a location, so the project id is part of the URL --
 * and it comes from the service account key, not from any form the user filled in.
 */

export interface GoogleModelPathInput {
  baseUrl: string;
  model: string;
  /** Required on Agent Platform. Read from the service account key, not asked for. */
  projectId?: string;
  /** The region the account chose, repeated in the path Vertex expects. */
  location?: string;
}

export function googleModelPath(input: GoogleModelPathInput): string {
  const trimmed = input.baseUrl.replace(/\/+$/, "");
  const model = encodeURIComponent(input.model);

  if (!/aiplatform\.googleapis\.com/.test(trimmed)) {
    return `${trimmed}/models/${model}:generateContent`;
  }

  // Agent Platform Express authenticates with an API key and has no project/location prefix.
  // A service account does carry a project, and therefore takes the full Vertex resource path.
  if (!input.projectId?.trim()) {
    return `${trimmed}/publishers/google/models/${model}:generateContent`;
  }

  const location = input.location?.trim() || "global";
  return (
    `${trimmed}/projects/${input.projectId.trim()}/locations/${location}` +
    `/publishers/google/models/${model}:generateContent`
  );
}
