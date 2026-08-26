import { useEffect, useState } from "react";
import { createProject } from "@clash/web-ui/lib/clientActions";
import ProjectCard from "./ProjectCard";
import ProjectCreateTile from "./ProjectCreateTile";
import { AppPage, AppPageHeader } from "./AppPage";
import { BrandAsset } from "./BrandAsset";

interface ProjectsClientProps {
  projects: any[]; // Using relaxed type to accommodate Drizzle result with assets
}

export default function ProjectsClient({ projects }: ProjectsClientProps) {
  const [projectList, setProjectList] = useState(projects || []);
  useEffect(() => setProjectList(projects || []), [projects]);
  const isEmpty = projectList.length === 0;

  return (
    <div className="clash-dashboard-shell min-h-screen">
      <AppPage width="wide">
        <AppPageHeader
          title="Projects"
          description="Open a canvas or start a new one."
        />

        {/* Projects Grid */}
        <div
          className={
            isEmpty
              ? "clash-projects-empty-workbench"
              : "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          }
        >
          <ProjectCreateTile
            ariaLabel="Create a new project"
            empty={isEmpty}
            onCreate={async (projectName) => {
              await createProject(projectName, { startFromPrompt: false });
            }}
          />

          {isEmpty ? (
            <div className="clash-projects-empty-canvas" aria-hidden="true">
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 920 360"
                fill="none"
                role="presentation"
              >
                <path
                  className="clash-projects-empty-edge"
                  d="M244 162 C 330 116, 382 116, 466 162"
                />
                <path
                  className="clash-projects-empty-edge clash-projects-empty-edge--slow"
                  d="M566 172 C 642 222, 704 232, 800 186"
                />
              </svg>
              <div className="clash-projects-empty-node clash-projects-empty-node--brief">
                <span>Brief</span>
                <strong>First cut, open frame</strong>
              </div>
              <div className="clash-projects-empty-node clash-projects-empty-node--agent">
                <BrandAsset name="markAnimated" alt="" />
                <strong>Agent pass</strong>
              </div>
              <div className="clash-projects-empty-node clash-projects-empty-node--shot">
                <div />
                <strong>Shot board</strong>
              </div>
            </div>
          ) : (
            projectList.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onArchived={(projectId) =>
                  setProjectList((current) =>
                    current.filter((item) => item.id !== projectId),
                  )
                }
              />
            ))
          )}
        </div>
      </AppPage>
    </div>
  );
}
