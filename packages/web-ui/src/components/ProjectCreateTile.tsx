import { Plus } from '@phosphor-icons/react';

import { Button } from './ui/button';

interface ProjectCreateTileProps {
    ariaLabel: string;
    empty?: boolean;
    onActivate: () => void | Promise<void>;
}

export default function ProjectCreateTile({ ariaLabel, empty = false, onActivate }: ProjectCreateTileProps) {
    return (
        <Button
            aria-label={ariaLabel}
            className={`${empty ? 'clash-project-create-tile--empty ' : ''}clash-project-create-tile group flex aspect-video min-h-0 flex-col items-center justify-center gap-4 rounded-2xl p-0 focus-visible:ring-offset-warm-page`}
            onClick={() => { void onActivate(); }}
        >
            <div className="clash-project-create-icon flex h-14 w-14 items-center justify-center rounded-xl">
                <Plus
                    className="h-7 w-7 text-stone-600 transition-colors group-hover:text-brand dark:text-stone-300"
                    weight="bold"
                    aria-hidden="true"
                />
            </div>
            <span className="text-base font-semibold text-stone-700 transition-colors group-hover:text-slate-950 dark:text-stone-300 dark:group-hover:text-slate-50">
                New Project
            </span>
        </Button>
    );
}
