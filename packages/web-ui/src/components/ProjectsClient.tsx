
import { motion } from 'framer-motion';
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
                        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                            Video Projects
                        </h1>
                        <p className="mt-2 text-base text-gray-600">
                            Manage and track all your video creation projects
                        </p>
                    </div>
                </header>

                {/* Projects Grid */}
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {/* New Project Card */}
                    <motion.button
                        className="group flex aspect-video flex-col items-center justify-center gap-4 rounded-[2rem] border-2 border-dashed border-gray-200 bg-white/50 transition-all hover:border-brand/30 hover:bg-white"
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={async () => {
                            const prompt = window.prompt('Enter a name or description for your new video project:');
                            if (prompt) {
                                await createProject(prompt);
                            }
                        }}
                    >
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm transition-transform group-hover:scale-110">
                            <Plus
                                className="h-8 w-8 text-gray-400 transition-colors group-hover:text-brand"
                                weight="bold"
                            />
                        </div>
                        <span className="text-lg font-medium text-gray-500 group-hover:text-gray-900">New Project</span>
                    </motion.button>

                    {projects.map((project) => (
                        <ProjectCard key={project.id} project={project} />
                    ))}
                </div>
            </div>
        </div>
    );
}
