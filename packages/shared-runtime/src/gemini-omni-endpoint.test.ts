import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'gemini-omni.ts'), 'utf8');

/**
 * The Interactions API, as Google documents it and as it actually answers.
 *
 *   POST https://aiplatform.googleapis.com/v1beta1/projects/{PROJECT}/locations/global/interactions
 *   Authorization: Bearer $(gcloud auth print-access-token)
 *
 * Every part of what we sent was wrong, and each part fails differently:
 *
 *   - host `generativelanguage.googleapis.com` -> 403, that API is blocked for a Cloud key
 *   - version `v1beta` instead of `v1beta1`    -> 404
 *   - no `projects/{id}/locations/global`      -> 404
 *   - header `x-goog-api-key`                  -> 401 "API keys are not supported by this API"
 *
 * All four measured against the live API. The 401 is the one that matters: this surface takes a
 * token, so an api key cannot reach it however the url is spelled.
 */
describe('gemini omni endpoint', () => {
  it('knows the agent platform host', () => {
    expect(source).toMatch(/aiplatform\.googleapis\.com/);
  });

  it('keeps the developer api host, which serves interactions too', () => {
    // Measured: POST /v1beta/interactions on generativelanguage answers 403 "Gemini API has not
    // been used in project ..." -- a routed request refused on project configuration, not a 404, so
    // the endpoint exists. Whether an api key succeeds there is untested: the key on hand is a Cloud
    // key whose project has the Gemini API off. Dropping this surface was still wrong, because the
    // evidence said the route was real.
    expect(source).toMatch(/generativelanguage\.googleapis\.com/);
  });

  it('uses v1beta1 for agent platform and v1beta for the developer api', () => {
    // Not interchangeable: /v1beta1/interactions on generativelanguage is 404, and /v1/interactions
    // on aiplatform is 404 as well. Each surface has exactly one spelling.
    expect(source).toMatch(/v1beta1/);
    expect(source).toMatch(/v1beta\b/);
  });

  it('addresses a project only on agent platform', () => {
    expect(source).toMatch(/projects\/\$\{[^}]+\}\/locations\/global/);
  });

  it('sends a bearer token to agent platform and an api key to the developer api', () => {
    expect(source).toMatch(/Bearer \$\{/);
    expect(source).toMatch(/x-goog-api-key/);
  });

  it('has no cloudflare gateway branch left', () => {
    // Removed several changes ago; this file still carried a hostname check for it.
    expect(source).not.toMatch(/gateway\.ai\.cloudflare\.com/);
  });
});


/**
 * What the request may contain, measured against the live API with a real token.
 *
 * A full generation now runs end to end: POST to the Agent Platform interactions collection returns
 * `status: "completed"` with the video inline as base64 — 2476780 bytes, `ISO Media, MP4 Base Media
 * v1`, confirmed with `file`.
 *
 * The one field that was wrong had never been exercised, because nothing could authenticate to find
 * out:
 *
 *   "delivery": "uri"  -> 400 "Video delivery mode 'URI' requires a `gcs_uri`"
 *
 * We asked for delivery by uri and supplied no bucket, so every omni request would have failed at
 * the vendor. Removing it returns the video inline, which is what the documented minimal body does.
 *
 * Confirmed working in the same run: `aspect_ratio` (9:16 accepted), `duration`, `store`, `stream`,
 * and `background: true` — which returns `in_progress` and makes the call asynchronous, so it stays
 * opt-in rather than being sent always.
 */
describe('interaction request body', () => {
  it('does not ask for uri delivery without a bucket to deliver to', () => {
    // Matched in code, not in prose: the explanation above names the field it removed.
    expect(source).not.toMatch(/^\s*delivery: "uri",/m);
  });

  it('keeps the fields the API accepts', () => {
    expect(source).toMatch(/aspect_ratio/);
    expect(source).toMatch(/duration/);
  });
});

/**
 * Delivery to a bucket, for callers who have one.
 *
 * Inline base64 costs a third more on the wire than the file it carries — measured on one
 * generation: 3302376 characters for 2476780 bytes of MP4 — and the whole video passes through
 * memory. `delivery: "uri"` avoids both by writing to Google Cloud Storage, and needs `gcs_uri` to
 * say where. Asking for it without a bucket is a 400, which is what we used to do unconditionally.
 *
 * So it is offered, not assumed: a caller with a bucket names it, everyone else gets bytes.
 */
describe('gcs delivery', () => {
  it('is available when a bucket is given', () => {
    expect(source).toMatch(/gcs_uri/);
  });

  it('is not requested when no bucket is given', () => {
    // The two fields travel together; sending the mode alone is the 400 we already earned once.
    expect(source).toMatch(/gcsUri\s*\?[\s\S]{0,200}?delivery/);
  });
});
