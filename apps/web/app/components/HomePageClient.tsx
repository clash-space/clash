'use client';

import type { InferSelectModel } from 'drizzle-orm';
import type { projects } from '../../lib/db/app.schema';
type Project = InferSelectModel<typeof projects>;
import HeroSection from './HeroSection';
import RecentProjects from './RecentProjects';

interface HomePageClientProps {
    initialProjects: Project[];
}

export default function HomePageClient({ initialProjects }: HomePageClientProps) {
    return (
        <div className="text-gray-900">
            <HeroSection />
            <RecentProjects projects={initialProjects} />
        </div>
    );
}
