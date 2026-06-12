
import {
    Plus,
} from '@phosphor-icons/react';
import { Link } from 'react-router';
import ProjectCard from './ProjectCard';

interface RecentProjectsProps {
    projects: any[]; // Relaxed type to accept Drizzle result with assets
}

export default function RecentProjects({ projects }: RecentProjectsProps) {
    // We want to show the section even if there are no projects, so the user can see the "New Project" card
    const projectList = projects || [];

    return (
        <div className="w-full max-w-[1600px] mx-auto px-6 pb-24 mt-0">
            <div className="mb-8 flex items-center justify-between px-2">
                <h2 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">Recent Projects</h2>
                <Link
                    to="/projects"
                    className="text-lg font-medium text-stone-700 transition-colors hover:text-brand dark:text-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page rounded"
                >
                    See All →
                </Link>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {/* Empty State Card / New Project */}
                <button
                    type="button"
                    aria-label="Start a new project"
                    className="group flex aspect-video flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-warm-border bg-warm-muted/60 transition-colors hover:border-brand/40 hover:bg-warm-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page"
                    onClick={() => {
                        document.querySelector('textarea')?.focus();
                        window.scrollTo({ top: 0, behavior: 'smooth' });
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

                {/* Project Cards */}
                {projectList.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                ))}
            </div>
        </div>
    );
}
