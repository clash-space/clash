import { useCallback } from "react";
import type { ActivityMessage } from "@clash/shared-types";

import { useAppFeedback } from "./AppFeedback";

const actionVerbs: Record<ActivityMessage["action"], string> = {
  added: "added",
  updated: "edited",
  deleted: "removed",
};

/**
 * Collaboration activity is an input adapter, not a second toast system.
 * Routing it through AppFeedback keeps one viewport, timer policy, live-region
 * contract, and reduced-motion behavior for every transient notification.
 */
export function useActivityToasts() {
  const feedback = useAppFeedback();

  const addToast = useCallback(
    (activity: ActivityMessage) => {
      const label = activity.label || activity.nodeId;
      feedback.notify({
        title: `${activity.actor.name} ${actionVerbs[activity.action]} ${label}`,
        variant: "info",
      });
    },
    [feedback],
  );

  return { addToast };
}
