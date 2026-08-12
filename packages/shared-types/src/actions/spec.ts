import { z } from 'zod';
import { AssetKindSchema } from '../assets.js';

export const ActionFamilySchema = z.enum(['generate', 'edit', 'custom']);
export type ActionFamily = z.infer<typeof ActionFamilySchema>;

export const ActionExecutorSchema = z.enum([
  'model',
  'client-render',
  'server-transform',
  'runtime',
]);
export type ActionExecutor = z.infer<typeof ActionExecutorSchema>;

export const ActionOperationSpecSchema = z.object({
  id: z.string().min(1),
  executor: ActionExecutorSchema,
  outputKind: AssetKindSchema,
});
export type ActionOperationSpec = z.infer<typeof ActionOperationSpecSchema>;

/** Serializable discovery contract. Runtime functions never live in a spec. */
export const ActionSpecSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  family: ActionFamilySchema,
  inputKinds: z.array(AssetKindSchema).min(1),
  operations: z.array(ActionOperationSpecSchema).min(1),
});
export type ActionSpec = z.infer<typeof ActionSpecSchema>;

export const ActionInvocationModeSchema = z.enum(['explicit', 'implicit']);
export type ActionInvocationMode = z.infer<typeof ActionInvocationModeSchema>;

export const ActionSurfaceSchema = z.enum(['canvas', 'asset-preview']);
export type ActionSurface = z.infer<typeof ActionSurfaceSchema>;

export const ACTION_INVOCATION_MODE = {
  Explicit: 'explicit',
  Implicit: 'implicit',
} as const satisfies Record<string, ActionInvocationMode>;

export function invocationModeForSurface(surface: ActionSurface): ActionInvocationMode {
  return surface === 'canvas'
    ? ACTION_INVOCATION_MODE.Explicit
    : ACTION_INVOCATION_MODE.Implicit;
}
