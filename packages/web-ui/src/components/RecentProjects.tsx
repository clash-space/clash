
import { Link } from 'react-router';
import ProjectCard from './ProjectCard';
import ProjectCreateTile from './ProjectCreateTile';

interface RecentProjectsProps {
    projects: any[]; // Relaxed type to accept Drizzle result with assets
    onCreateProject: (projectName: string) => void | Promise<void>;
}

export default function RecentProjects({ projects, onCreateProject }: RecentProjectsProps) {
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
                <ProjectCreateTile ariaLabel="Start a new project" onCreate={onCreateProject} />

                {/* Project Cards */}
                {projectList.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                ))}
            </div>
        </div>
    );
}
