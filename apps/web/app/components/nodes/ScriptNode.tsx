import { memo, useState, useEffect } from 'react';
import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react';
import { Scroll, Plus } from '@phosphor-icons/react';

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
            className={`group relative min-w-[300px] overflow-hidden rounded-matrix bg-white shadow-lg transition-all duration-300 hover:shadow-xl ${selected ? 'ring-4 ring-purple-500 ring-offset-2' : 'ring-1 ring-slate-100'
                }`}
        >
            {/* Header */}
            <div className="relative flex h-16 items-center justify-between bg-gradient-to-r from-amber-400 to-orange-500 px-4">
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
                <div className="relative z-10 flex items-center gap-2 text-white">
                    <Scroll size={20} weight="fill" />
                    <span className="font-bold text-sm">Script / Screenplay</span>
                </div>
                <div className="relative z-10 rounded-full bg-black/20 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-md">
                    {shots.length} Shots
                </div>
            </div>

            {/* Content: Shot List */}
            <div className="max-h-[300px] overflow-y-auto p-2 bg-slate-50">
                <div className="space-y-2">
                    {shots.map((shot, index) => (
                        <div key={shot.id} className="relative rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-amber-300">
                            <div className="mb-1 flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase text-amber-600">Scene {index + 1}</span>
                            </div>
                            <p className="text-xs text-slate-700 font-medium leading-relaxed">{shot.content}</p>

                            {/* Handle for EACH shot? Or just one main handle? 
                                For this design, we'll keep one main handle, but in the future, 
                                we could have handles per shot. 
                            */}
                        </div>
                    ))}
                </div>

                <button
                    onClick={addShot}
                    className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                    <Plus size={14} />
                    Add Scene
                </button>
            </div>

            {/* Handles */}
            <div className={`absolute inset-0 -z-10 h-full w-full rounded-matrix border-2 border-dashed bg-slate-50/50 transition-all ${selected ? 'border-amber-400 bg-amber-50/30' : 'border-slate-300'
                }`}></div>
            <Handle
                type="target"
                position={Position.Left}
                className="!h-4 !w-4 !-translate-x-2 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-amber-500 hover:scale-125 shadow-sm"
            />
            <Handle
                type="source"
                position={Position.Right}
                className="!h-4 !w-4 !translate-x-2 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-amber-500 hover:scale-125 shadow-sm"
            />
        </div>
    );
};

export default memo(ScriptNode);
