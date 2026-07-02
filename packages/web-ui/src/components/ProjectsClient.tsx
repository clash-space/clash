
import { createProject } from '@clash/web-ui/lib/clientActions';
import ProjectCard from './ProjectCard';
import ProjectCreateTile from './ProjectCreateTile';

interface ProjectsClientProps {
    projects: any[]; // Using relaxed type to accommodate Drizzle result with assets
}

export default function ProjectsClient({ projects }: ProjectsClientProps) {
    const projectList = projects || [];
    const isEmpty = projectList.length === 0;

    return (
        <div className="clash-dashboard-shell min-h-screen">
            <div className="mx-auto max-w-[1600px] px-6 pb-24 pt-20">
                {/* Header */}
                <header className={isEmpty ? "mb-8" : "mb-10"}>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">
                            Projects
                        </h1>
                        <p className="mt-2 text-base text-stone-700 dark:text-stone-300">
                            Open a canvas or start a new one.
                        </p>
                    </div>
                </header>

                {/* Projects Grid */}
                <div className={isEmpty ? "clash-projects-empty-workbench" : "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}>
                    <ProjectCreateTile
                        ariaLabel="Create a new project"
                        empty={isEmpty}
                        onActivate={async () => {
                            await createProject('Untitled project', { startFromPrompt: false });
                        }}
                    />

                    {isEmpty ? (
                        <div className="clash-projects-empty-canvas" aria-hidden="true">
                            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 920 360" fill="none" role="presentation">
                                <path className="clash-projects-empty-edge" d="M244 162 C 330 116, 382 116, 466 162" />
                                <path className="clash-projects-empty-edge clash-projects-empty-edge--slow" d="M566 172 C 642 222, 704 232, 800 186" />
                            </svg>
                            <div className="clash-projects-empty-node clash-projects-empty-node--brief">
                                <span>Brief</span>
                                <strong>First cut, open frame</strong>
                            </div>
                            <div className="clash-projects-empty-node clash-projects-empty-node--agent">
                                <img src="/brand/logo-mark-animated.svg" alt="" draggable={false} />
                                <strong>Agent pass</strong>
                            </div>
                            <div className="clash-projects-empty-node clash-projects-empty-node--shot">
                                <div />
                                <strong>Shot board</strong>
                            </div>
                        </div>
                    ) : (
                        projectList.map((project) => (
                            <ProjectCard key={project.id} project={project} />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
