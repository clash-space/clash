import type {
  AgentAnnotationDraft,
  AgentAnnotationTarget,
} from "@clash/shared-types";
import { BrowserSurface } from "./BrowserSurface";
import type { ProjectBrowserTab } from "./ProjectWorkspaceNavigator";

export function ProjectBrowserSurfaces({
  projectId,
  tabs,
  activeBrowserId,
  annotations,
  activeAnnotationId,
  onTabChange,
  onCreateAnnotation,
  onSelectAnnotation,
}: {
  projectId: string;
  tabs: readonly ProjectBrowserTab[];
  activeBrowserId: string | null;
  annotations: readonly AgentAnnotationDraft[];
  activeAnnotationId: string | null;
  onTabChange: (
    browserId: string,
    patch: Partial<Pick<ProjectBrowserTab, "title" | "url">>,
  ) => void;
  onCreateAnnotation: (target: AgentAnnotationTarget) => string;
  onSelectAnnotation: (annotationId: string) => void;
}) {
  return tabs.map((tab) => {
    const active = tab.id === activeBrowserId;
    return (
      <div
        key={tab.id}
        data-project-browser-slot={tab.id}
        data-active={active ? "true" : "false"}
        aria-hidden={active ? undefined : true}
        className={`absolute inset-0 z-10 ${
          active ? "visible" : "invisible pointer-events-none"
        }`}
      >
        <BrowserSurface
          projectId={projectId}
          tab={tab}
          annotations={annotations}
          activeAnnotationId={activeAnnotationId}
          onTabChange={(patch) => onTabChange(tab.id, patch)}
          onCreateAnnotation={onCreateAnnotation}
          onSelectAnnotation={onSelectAnnotation}
        />
      </div>
    );
  });
}
