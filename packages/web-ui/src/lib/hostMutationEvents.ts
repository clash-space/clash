import type { HostMutationRecord } from "@clash/shared-types";

export const HOST_MUTATION_EVENT = "clash:host-mutation";

export interface HostMutationEventDetail {
  projectId: string;
  mutation: HostMutationRecord;
}

export function dispatchHostMutationEvent(
  projectId: string,
  mutation: HostMutationRecord,
  target: Pick<Window, "dispatchEvent"> | undefined = typeof window === "undefined" ? undefined : window,
): boolean {
  if (!target || typeof CustomEvent === "undefined") return false;
  return target.dispatchEvent(
    new CustomEvent<HostMutationEventDetail>(HOST_MUTATION_EVENT, {
      detail: { projectId, mutation },
    }),
  );
}
