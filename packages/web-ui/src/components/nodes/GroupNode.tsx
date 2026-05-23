
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Node, NodeProps, NodeResizeControl, useNodes, useReactFlow, useViewport } from '@xyflow/react';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { useLayoutActions } from '../LayoutActionsContext';
import { MagicWand, FrameCorners } from '@phosphor-icons/react';

const controlStyle = {
    background: '#FF9900',
    border: 'none',
    borderRadius: '50%',
    width: 10,
    height: 10,
};

const GroupNode = ({ selected, data, id }: NodeProps<Node<Record<string, any>>>) => {
    const [label, setLabel] = useState(data.label || 'Group');
    const nodes = useNodes();
    const { setNodes } = useReactFlow();
    // Counter-scale the action cluster so the buttons stay at constant screen
    // size — matches the floating "Group" pill, which lives in screen-space.
    const { zoom } = useViewport();
    const loroSync = useOptionalLoroSyncContext();
    const { relayoutParent, ungroup } = useLayoutActions();
    const syncTimeoutRef = useRef<number | null>(null);

    // Calculate nesting depth
    const depth = useMemo(() => {
        let currentId = id;
        let level = 0;

        while (currentId) {
            const node = nodes.find((n) => n.id === currentId);
            if (!node || !node.parentId) break;
            currentId = node.parentId;
            level++;
        }

        return level;
    }, [id, nodes]);

    useEffect(() => {
        if (typeof data.label === 'string' && data.label !== label) {
            setLabel(data.label);
        }
    }, [data.label, label]);

    // Generate background color based on depth
    const backgroundColor = useMemo(() => {
        if (selected) return 'bg-[#FFF8F0]';

        // Each level adds more opacity to the slate background
        const opacities = [40, 50, 60, 70, 80]; // 40%, 50%, 60%, etc.
        const opacity = opacities[Math.min(depth, opacities.length - 1)];
        return `bg-slate-100/${opacity}`;
    }, [depth, selected]);

    const scheduleLoroSync = (nextLabel: string) => {
        if (!loroSync?.connected) return;
        if (syncTimeoutRef.current) {
            window.clearTimeout(syncTimeoutRef.current);
        }
        syncTimeoutRef.current = window.setTimeout(() => {
            loroSync.updateNode(id, {
                data: { label: nextLabel },
            });
        }, 250);
    };

    useEffect(() => {
        return () => {
            if (syncTimeoutRef.current) {
                window.clearTimeout(syncTimeoutRef.current);
            }
        };
    }, []);

    return (
        <>
            {selected && (
                <>
                    <NodeResizeControl style={controlStyle} position="top-left" />
                    <NodeResizeControl style={controlStyle} position="top-right" />
                    <NodeResizeControl style={controlStyle} position="bottom-left" />
                    <NodeResizeControl style={controlStyle} position="bottom-right" />
                </>
            )}

            <div
                className={`h-full w-full border-2 transition-all duration-300 ${selected ? 'border-[#FF9900]' : 'border-slate-300'} ${backgroundColor}`}
            >
                {/* Floating Title Input */}
                <div
                    className="absolute -top-8 left-4 z-10"
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <input
                        className="bg-transparent text-lg font-bold font-display text-slate-700 dark:text-slate-300 focus:text-slate-900 focus:outline-none"
                        value={label}
                        onChange={(evt) => {
                            const nextLabel = evt.target.value;
                            setLabel(nextLabel);
                            setNodes((nds) =>
                                nds.map((n: Node) =>
                                    n.id === id
                                        ? {
                                              ...n,
                                              data: {
                                                  ...(n.data || {}),
                                                  label: nextLabel,
                                              },
                                          }
                                        : n
                                )
                            );
                            scheduleLoroSync(nextLabel);
                        }}
                    />
                </div>

                {/* Top-right action cluster — only visible when the group is
                    selected (mirrors the floating "Group" pill, which also
                    only appears for an active selection). Same pill style as
                    that pill so group/ungroup read as a matched pair, and
                    counter-scaled so size + gap stay constant in screen px. */}
                {selected && (
                <div
                    className="absolute z-10 flex items-center gap-1.5"
                    style={{
                        right: 0,
                        bottom: '100%',
                        marginBottom: 8 / zoom,
                        transform: `scale(${1 / zoom})`,
                        transformOrigin: '100% 100%',
                    }}
                >
                    <button
                        type="button"
                        className="flex h-7 items-center gap-1.5 rounded-md border border-warm-border bg-white/90 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 shadow-sm backdrop-blur hover:bg-white hover:text-slate-900"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            ungroup(id);
                        }}
                        title="Ungroup (release children to parent)"
                    >
                        <FrameCorners className="h-3.5 w-3.5" weight="regular" />
                        Ungroup
                    </button>
                    <button
                        type="button"
                        className="flex h-7 items-center gap-1.5 rounded-md border border-warm-border bg-white/90 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 shadow-sm backdrop-blur hover:bg-white hover:text-slate-900"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            relayoutParent(id);
                        }}
                        title="Relayout inside group"
                    >
                        <MagicWand className="h-3.5 w-3.5" weight="regular" />
                        Layout
                    </button>
                </div>
                )}
            </div>
        </>
    );
};

export default memo(GroupNode);
