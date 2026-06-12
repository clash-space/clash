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
            className={`group relative min-w-[300px] overflow-hidden rounded-matrix bg-warm-surface shadow-md transition-all duration-300 hover:shadow-lg ${selected ? 'ring-4 ring-brand ring-offset-2' : 'ring-1 ring-warm-border'
                }`}
        >
            {/* Header */}
            <div className="relative flex h-14 items-center justify-between border-b border-warm-border bg-warm-surface px-4">
                <div className="relative z-10 flex items-center gap-2 text-slate-900 dark:text-slate-50">
                    <PaintBrush size={20} weight="fill" />
                    <span className="font-bold text-sm">Storyboard / Prompt</span>
                </div>
            </div>

            <div className="p-3 space-y-3">
                {/* Shot Selector */}
                <div className="flex items-center justify-between rounded-md bg-warm-muted p-2 border border-warm-border">
                    <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                        <LinkIcon size={14} />
                        <span>Linked to:</span>
                    </div>

                    {shots.length > 0 ? (
                        <select
                            className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-200 outline-none cursor-pointer max-w-[150px]"
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
                    <div className="text-xs text-slate-700 dark:text-slate-300 italic border-l-2 border-brand/35 pl-2 py-1 bg-brand-light/60 rounded-r">
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
                        <label className="text-[10px] font-bold uppercase text-slate-700 dark:text-slate-300">Visual Prompt</label>
                        <button className="text-[10px] flex items-center gap-1 text-brand hover:text-slate-950 font-medium">
                            <MagicWand size={12} />
                            AI Enhance
                        </button>
                    </div>
                    <textarea
                        className="w-full h-24 rounded-lg border border-warm-border bg-warm-muted p-2 text-xs text-slate-800 dark:text-slate-200 focus:border-brand focus:ring-1 focus:ring-brand outline-none resize-none"
                        value={visualPrompt}
                        onChange={(e) => setVisualPrompt(e.target.value)}
                    />
                </div>
            </div>

            {/* Handles */}
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

export default memo(StoryboardNode);
