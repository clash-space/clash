/**
 * Hosted entry — wraps the OSS api-cf core with proprietary plugins.
 *
 * The OSS code lives under apps/api-cf and is published under the project's
 * open-source license. This package is proprietary: it imports createApp
 * from api-cf and installs plugins (billing, BYOK key resolution, quota,
 * etc.) before any request runs.
 *
 * Step 1 of the OSS / hosted split: this file currently registers no
 * plugins, so its behavior is identical to the OSS entry. As packages/billing
 * comes online, swap the empty array for [billingPlugin].
 */
import { createApp } from "@master-clash/api-cf/src/app";

// Re-export the OSS Durable Object / Workflow / Container classes so the
// hosted Wrangler bundle exposes them under the same binding names.
export {
  ProjectRoom,
  SupervisorAgent,
  GenerationWorkflow,
  RenderContainer,
} from "@master-clash/api-cf/src/index";

const app = createApp({
  plugins: [
    // billingPlugin,  // wired in once packages/billing is in place
  ],
});

export default app;
