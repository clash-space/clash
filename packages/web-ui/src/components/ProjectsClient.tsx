
import { Plus } from '@phosphor-icons/react';
import { createProject } from '@clash/web-ui/lib/clientActions';
import ProjectCard from './ProjectCard';

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
                    {/* New Project Card */}
                    <button
                        type="button"
                        aria-label="Create a new project"
                        className={`${isEmpty ? "clash-project-create-tile--empty" : ""} clash-project-create-tile group flex aspect-video flex-col items-center justify-center gap-4 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page`}
                        onClick={async () => {
                            await createProject('Untitled project', { startFromPrompt: false });
                        }}
                    >
                        <div className="clash-project-create-icon flex h-14 w-14 items-center justify-center rounded-xl">
                            <Plus
                                className="h-7 w-7 text-stone-600 transition-colors group-hover:text-brand dark:text-stone-300"
                                weight="bold"
                                aria-hidden="true"
                            />
                        </div>
                        <span className="text-base font-semibold text-stone-700 transition-colors group-hover:text-slate-950 dark:text-stone-300 dark:group-hover:text-slate-50">New Project</span>
                    </button>

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
