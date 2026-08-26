import { useCallback } from "react";
import type { Project } from "@clash/web-ui/lib/types";
import { createProject } from "@clash/web-ui/lib/clientActions";
import type { RegistryItem } from "@clash/web-ui/lib/clientActions";
import HomeMarketplaceRecommendations from "./HomeMarketplaceRecommendations";
import HomeOperations from "./HomeOperations";
import RecentProjects from "./RecentProjects";
import { AppPage } from "./AppPage";
import { useOptionalDashboardComposer } from "./DashboardComposerContext";

interface HomePageClientProps {
  initialProjects: Project[];
  marketplaceFeed?: {
    featuredPlugins: RegistryItem[];
    installedActionIds: string[];
    installedSkillIds: string[];
  };
}

export default function HomePageClient({
  initialProjects,
  marketplaceFeed = {
    featuredPlugins: [],
    installedActionIds: [],
    installedSkillIds: [],
  },
}: HomePageClientProps) {
  const composer = useOptionalDashboardComposer();
  const handleCreateProject = useCallback(async (projectName: string) => {
    await createProject(projectName, { startFromPrompt: false });
  }, []);

  return (
    <div className="clash-home-page min-h-full bg-warm-page text-content-primary">
      <AppPage className="clash-home-section-stack">
        <RecentProjects
          projects={initialProjects}
          onCreateProject={handleCreateProject}
          composerProjectReferenceId={composer?.references.project?.id ?? null}
          onAddProjectReference={composer?.addProjectReference}
        />
        <HomeOperations />
        <HomeMarketplaceRecommendations {...marketplaceFeed} />
      </AppPage>
    </div>
  );
}
