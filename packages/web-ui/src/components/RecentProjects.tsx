
import { motion } from 'framer-motion';
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
                <h2 className="text-3xl font-bold tracking-tight text-slate-950">Recent Projects</h2>
                <Link
                    to="/projects"
                    className="text-lg font-medium text-stone-500 transition-colors hover:text-brand"
                >
                    See All →
                </Link>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {/* Empty State Card / New Project */}
                <motion.button
                    className="group flex aspect-video flex-col items-center justify-center gap-4 rounded-[2rem] border-2 border-dashed border-warm-border bg-warm-muted/60 transition-all hover:border-brand/40 hover:bg-warm-surface"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                        // Focus the textarea in the HeroSection
                        document.querySelector('textarea')?.focus();
                        // Scroll to top to ensure textarea is visible
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                >
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-warm-border transition-transform group-hover:scale-110">
                        <Plus
                            className="h-8 w-8 text-stone-400 transition-colors group-hover:text-brand"
                            weight="bold"
                        />
                    </div>
                    <span className="text-lg font-medium text-stone-500 group-hover:text-slate-950">New Project</span>
                </motion.button>

                {/* Project Cards */}
                {projectList.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                ))}
            </div>
        </div>
    );
}
