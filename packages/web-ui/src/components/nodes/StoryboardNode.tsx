import { memo, useState, useEffect, useMemo } from 'react';
import { Handle, Position, NodeProps, Node, useNodes, useEdges } from '@xyflow/react';
import { PaintBrush, Link as LinkIcon, MagicWand, Warning } from '@phosphor-icons/react';
import { Shot } from './ScriptNode';

const StoryboardNode = ({ id, data: _data, selected }: NodeProps<Node<Record<string, any>>>) => {
    // React Flow v11 compatible approach
    const nodes = useNodes();
    const edges = useEdges();

    // 1. Find the edge connected to this node's target handle
    const connectedEdge = edges.find(
        (edge) => edge.target === id
    );

    // 2. Find the source node
    const sourceNode = connectedEdge
        ? nodes.find((n) => n.id === connectedEdge.source)
        : null;

    // 3. Extract shots from the source node if it's a script node
    const shots: Shot[] = useMemo(() => {
        if (sourceNode && sourceNode.type === 'script' && sourceNode.data && Array.isArray((sourceNode.data as any).shots)) {
            return (sourceNode.data as any).shots as Shot[];
        }
        return [];
    }, [sourceNode]);

    const [linkedShotId, setLinkedShotId] = useState<string>('');
    const [visualPrompt, setVisualPrompt] = useState(
        "Cinematic wide shot, cyberpunk city street at night, neon rain, blade runner style, 8k resolution"
    );

    // Auto-select the first shot if available and nothing selected
    useEffect(() => {
        if (shots.length > 0 && !linkedShotId) {
            setLinkedShotId(shots[0].id);
        }
    }, [shots, linkedShotId]);

    // Find the currently selected shot object
    const linkedShot = shots.find(s => s.id === linkedShotId);

    return (
        <div
            className={`group relative min-w-[300px] overflow-hidden rounded-matrix bg-white shadow-lg transition-all duration-300 hover:shadow-xl ${selected ? 'ring-4 ring-purple-500 ring-offset-2' : 'ring-1 ring-slate-100'
                }`}
        >
            {/* Header */}
            <div className="relative flex h-14 items-center justify-between bg-gradient-to-r from-purple-500 to-indigo-600 px-4">
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
                <div className="relative z-10 flex items-center gap-2 text-white">
                    <PaintBrush size={20} weight="fill" />
                    <span className="font-bold text-sm">Storyboard / Prompt</span>
                </div>
            </div>

            <div className="p-3 space-y-3">
                {/* Shot Selector */}
                <div className="flex items-center justify-between rounded-md bg-slate-50 p-2 border border-slate-200">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                        <LinkIcon size={14} />
                        <span>Linked to:</span>
                    </div>

                    {shots.length > 0 ? (
                        <select
                            className="bg-transparent text-xs font-bold text-slate-700 outline-none cursor-pointer max-w-[150px]"
                            value={linkedShotId}
                            onChange={(e) => setLinkedShotId(e.target.value)}
                        >
                            {shots.map((shot, _) => (
                                <option key={shot.id} value={shot.id}>
                                    Scene {shot.scene}: {shot.content.substring(0, 15)}...
                                </option>
                            ))}
                        </select>
                    ) : (
                        <span className="text-[10px] text-red-400 flex items-center gap-1">
                            <Warning /> No Script Connected
                        </span>
                    )}
                </div>

                {/* Reference Text (Read-only) */}
                {linkedShot ? (
                    <div className="text-xs text-slate-500 italic border-l-2 border-purple-200 pl-2 py-1 bg-purple-50/50 rounded-r">
                        "{linkedShot.content}"
                    </div>
                ) : (
                    <div className="text-xs text-slate-300 italic pl-2">
                        Connect a Script Node to see scene text...
                    </div>
                )}

                {/* Visual Prompt Editor */}
                <div>
                    <div className="mb-1 flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase text-slate-500">Visual Prompt</label>
                        <button className="text-[10px] flex items-center gap-1 text-purple-600 hover:text-purple-700 font-medium">
                            <MagicWand size={12} />
                            AI Enhance
                        </button>
                    </div>
                    <textarea
                        className="w-full h-24 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none resize-none"
                        value={visualPrompt}
                        onChange={(e) => setVisualPrompt(e.target.value)}
                    />
                </div>
            </div>

            {/* Handles */}
            <Handle
                type="target"
                position={Position.Left}
                className="!h-4 !w-4 !-translate-x-2 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-purple-500 hover:scale-125 shadow-sm"
            />
            <Handle
                type="source"
                position={Position.Right}
                className="!h-4 !w-4 !translate-x-2 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-purple-500 hover:scale-125 shadow-sm"
            />
        </div>
    );
};

export default memo(StoryboardNode);
