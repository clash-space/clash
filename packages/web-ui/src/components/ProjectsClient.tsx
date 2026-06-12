
import { Plus } from '@phosphor-icons/react';
import { createProject } from '@clash/web-ui/lib/clientActions';
import ProjectCard from './ProjectCard';

interface ProjectsClientProps {
    projects: any[]; // Using relaxed type to accommodate Drizzle result with assets
}

export default function ProjectsClient({ projects }: ProjectsClientProps) {
    return (
        <div className="min-h-screen">
            <div className="mx-auto max-w-[1600px] px-6 py-24 mt-12">
                {/* Header */}
                <header className="mb-12 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">
                            Video Projects
                        </h1>
                        <p className="mt-2 text-base text-stone-700 dark:text-stone-300">
                            Manage and track all your video creation projects
                        </p>
                    </div>
                </header>

                {/* Projects Grid */}
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {/* New Project Card */}
                    <button
                        type="button"
                        aria-label="Create a new project"
                        className="group flex aspect-video flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-warm-border bg-warm-surface/70 transition-colors hover:border-brand/40 hover:bg-warm-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page"
                        onClick={async () => {
                            await createProject('Untitled project', { startFromPrompt: false });
                        }}
                    >
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-surface shadow-sm ring-1 ring-warm-border">
                            <Plus
                                className="h-8 w-8 text-stone-600 transition-colors group-hover:text-brand dark:text-stone-300"
                                weight="bold"
                                aria-hidden="true"
                            />
                        </div>
                        <span className="text-lg font-medium text-stone-700 group-hover:text-slate-950 dark:text-stone-300 dark:group-hover:text-slate-50">New Project</span>
                    </button>

                    {projects.map((project) => (
                        <ProjectCard key={project.id} project={project} />
                    ))}
                </div>
            </div>
        </div>
    );
}
