import { Folder, Plus } from "@phosphor-icons/react";
import { useDroppable } from "@dnd-kit/core";
import { agentChatDensityAttributes } from "@openma/common/chat-ui";
import {
  useEffect,
  useState,
  type PropsWithChildren,
  type ReactNode,
  type RefCallback,
} from "react";
import { useTranslation } from "react-i18next";

import { listProjects, type ProjectListItem } from "../lib/clientActions";
import { useDashboardComposer } from "./DashboardComposerContext";
import { DashboardComposerRuntime } from "./HeroSection";
import { DASHBOARD_COMPOSER_DROP_ID } from "./dashboardComposerDnd";
import type { DashboardProjectReference } from "./dashboardComposerReferences";
import { DESKTOP_SHELL_LAYERS } from "./desktopShellLayers";
import { SearchableSelect } from "./ui/searchable-select";

interface DashboardComposerDockFrameProps extends PropsWithChildren {
  isOver?: boolean;
  projectTag?: ReactNode;
  setNodeRef?: RefCallback<HTMLElement>;
}

/**
 * Route-stable dashboard shell. Runtime state lives above this presentational
 * boundary so Home and Marketplace can share one composer instance.
 */
export function DashboardComposerDockFrame({
  children,
  isOver = false,
  projectTag,
  setNodeRef,
}: DashboardComposerDockFrameProps) {
  const densityAttributes = agentChatDensityAttributes("compact");
  return (
    <section
      {...densityAttributes}
      role="region"
      aria-label="Dashboard composer"
      data-slot="dashboard-composer-dock"
      data-density="compact"
      data-chat-surface="main"
      data-size="lg"
      data-is-over={isOver ? "true" : "false"}
      style={{
        ...densityAttributes.style,
        zIndex: DESKTOP_SHELL_LAYERS.dashboardTask,
      }}
      className="clash-dashboard-composer-dock"
    >
      <div ref={setNodeRef} className="clash-dashboard-composer-dock-inner">
        {projectTag}
        <div className="clash-dashboard-composer-transition-surface">
          {children}
        </div>
      </div>
    </section>
  );
}

function DashboardProjectPicker({
  project,
  onSelect,
  onClear,
}: {
  project: DashboardProjectReference | null;
  onSelect: (project: DashboardProjectReference) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const newProjectValue = "__new_project__";
  const newProjectLabel = t("copilot.dashboardComposer.newProject", {
    defaultValue: "Create new project",
  });

  useEffect(() => {
    let active = true;
    void listProjects()
      .then((items) => {
        if (!active) return;
        setProjects(items);
        setFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setProjects([]);
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const options = [
    {
      value: newProjectValue,
      label: newProjectLabel,
      description: t("copilot.dashboardComposer.newProjectHint", {
        defaultValue: "Created when you send",
      }),
      icon: <Plus aria-hidden="true" weight="bold" />,
    },
    ...(projects ?? []).map((candidate) => ({
      value: candidate.id,
      label: candidate.name,
      icon: <Folder aria-hidden="true" weight="duotone" />,
    })),
  ];
  const currentLabel = project?.name ?? newProjectLabel;

  return (
    <SearchableSelect
      ariaLabel={t("copilot.dashboardComposer.chooseProject", {
        defaultValue: "Choose a project",
      })}
      searchAriaLabel={t("copilot.dashboardComposer.searchProjects", {
        defaultValue: "Search projects",
      })}
      searchPlaceholder={t("copilot.dashboardComposer.searchProjects", {
        defaultValue: "Search projects",
      })}
      emptyMessage={
        failed
          ? t("copilot.dashboardComposer.projectsUnavailable", {
              defaultValue: "Projects are unavailable.",
            })
          : t("copilot.dashboardComposer.noProjects", {
              defaultValue: "No existing projects.",
            })
      }
      options={options}
      value={project?.id ?? newProjectValue}
      onValueChange={(value) => {
        if (value === newProjectValue) {
          onClear();
          return;
        }
        const selectedProject = projects?.find(
          (candidate) => candidate.id === value,
        );
        if (selectedProject) onSelect(selectedProject);
      }}
      triggerLabel={
        <span className="clash-dashboard-composer-project-selector-label">
          {project ? (
            <Folder aria-hidden="true" weight="duotone" />
          ) : (
            <Plus aria-hidden="true" weight="bold" />
          )}
          <span>{currentLabel}</span>
        </span>
      }
      triggerClassName="clash-dashboard-composer-project-selector-trigger"
      contentClassName="clash-dashboard-composer-project-picker"
      context="composer"
      density="compact"
      listClassName="max-h-64"
      matchTriggerWidth
    />
  );
}

export default function DashboardComposerDock() {
  const { references, selectProjectReference, removeProjectReference } =
    useDashboardComposer();
  const { isOver, setNodeRef } = useDroppable({
    id: DASHBOARD_COMPOSER_DROP_ID,
  });

  return (
    <DashboardComposerDockFrame
      isOver={isOver}
      setNodeRef={setNodeRef}
      projectTag={
        <div
          role="group"
          aria-label="Project context"
          data-slot="dashboard-composer-project-context"
          data-state={references.project ? "selected" : "new"}
          className="clash-dashboard-composer-project-context"
        >
          <DashboardProjectPicker
            project={references.project}
            onSelect={selectProjectReference}
            onClear={removeProjectReference}
          />
        </div>
      }
    >
      <DashboardComposerRuntime />
    </DashboardComposerDockFrame>
  );
}
