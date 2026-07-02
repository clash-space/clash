import { memo, useState, useEffect } from 'react';
import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react';
import { Scroll, Plus } from '@phosphor-icons/react';
import { Button } from '../ui/button';

// Define the structure for a Shot
export interface Shot {
    id: string;
    scene: number;
    content: string;
}

const ScriptNode = ({ id, data, selected }: NodeProps<Node<Record<string, any>>>) => {
    const { setNodes } = useReactFlow();

    // Local state for shots
    const [shots, setShots] = useState<Shot[]>(data.shots || [
        { id: 's1', scene: 1, content: 'EXT. CYBERPUNK CITY - NIGHT' },
        { id: 's2', scene: 2, content: 'A neon sign flickers in the rain.' },
    ]);

    // Sync shots to node data whenever they change
    useEffect(() => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return {
                        ...node,
                        data: { ...node.data, shots, type: 'script' }, // Ensure type is set for identification
                    };
                }
                return node;
            })
        );
    }, [shots, id, setNodes]);

    const addShot = () => {
        const newShot = {
            id: `s${shots.length + 1}-${Date.now()}`,
            scene: shots.length + 1,
            content: 'New Scene Description...',
        };
        setShots([...shots, newShot]);
    };

    return (
        <div
            className={`group relative min-w-[300px] overflow-hidden rounded-matrix bg-warm-surface shadow-md transition-all duration-300 hover:shadow-lg ${selected ? 'ring-4 ring-brand ring-offset-2' : 'ring-1 ring-warm-border'
                }`}
        >
            {/* Header */}
            <div className="relative flex h-16 items-center justify-between border-b border-warm-border bg-warm-surface px-4">
                <div className="relative z-10 flex items-center gap-2 text-slate-900 dark:text-slate-50">
                    <Scroll size={20} weight="fill" />
                    <span className="font-bold text-sm">Script / Screenplay</span>
                </div>
                <div className="relative z-10 rounded-lg bg-brand-light px-2 py-1 text-[10px] font-semibold text-brand">
                    {shots.length} Shots
                </div>
            </div>

            {/* Content: Shot List */}
            <div className="max-h-[300px] overflow-y-auto p-2 bg-warm-muted">
                <div className="space-y-2">
                    {shots.map((shot, index) => (
                        <div key={shot.id} className="relative rounded-lg border border-warm-border bg-warm-surface p-3 shadow-sm transition-colors hover:border-brand/40">
                            <div className="mb-1 flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase text-brand">Scene {index + 1}</span>
                            </div>
                            <p className="text-xs text-slate-800 dark:text-slate-200 font-medium leading-relaxed">{shot.content}</p>

                            {/* Handle for EACH shot? Or just one main handle? 
                                For this design, we'll keep one main handle, but in the future, 
                                we could have handles per shot. 
                            */}
                        </div>
                    ))}
                </div>

                <Button
                    onClick={addShot}
                    size="sm"
                    shape="rounded"
                    leftIcon={<Plus size={14} />}
                    className="mt-3 min-h-0 w-full rounded-lg border-dashed border-warm-border py-2 text-xs text-slate-700 hover:border-brand/45 hover:bg-brand-light/60 hover:text-slate-900 dark:text-slate-300"
                >
                    Add Scene
                </Button>
            </div>

            {/* Handles */}
            <div className={`absolute inset-0 -z-10 h-full w-full rounded-matrix border-2 border-dashed bg-warm-muted/60 transition-all ${selected ? 'border-brand bg-brand-light/35' : 'border-warm-border'
                }`}></div>
            <Handle
                type="target"
                position={Position.Left}
                className="!h-4 !w-4 !-translate-x-2 !border-4 !border-warm-surface !bg-stone-400 transition-all hover:!bg-brand hover:scale-125 shadow-sm"
            />
            <Handle
                type="source"
                position={Position.Right}
                className="!h-4 !w-4 !translate-x-2 !border-4 !border-warm-surface !bg-stone-400 transition-all hover:!bg-brand hover:scale-125 shadow-sm"
            />
        </div>
    );
};

export default memo(ScriptNode);
