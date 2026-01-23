// Types
export * from './types';

// Core geometry utilities
export {
    getNodeSize,
    rectOverlaps,
    rectContains,
    rectContainsPoint,
    getAbsolutePosition,
    getAbsoluteRect,
    toRelativePosition,
    expandRect,
    rectUnion,
    getOverlapRect,
    nodeToNodeRect,
    getRectCenter,
    distance,
} from './core/geometry';

// Mesh/Grid system
export { Mesh, createMesh } from './core/mesh';

// Group hierarchy utilities
export {
    isDescendant,
    getAncestors,
    getDescendants,
    getChildren,
    getNestingDepth,
    getRootAncestor,
    getGroupNodes,
    getSiblings,
    sortByZIndex,
} from './group/hierarchy';

// Group ownership
export {
    determineGroupOwnership,
    checkOwnershipChange,
    applyOwnership,
    updateNodeOwnership,
    removeFromGroup,
    moveIntoGroup,
} from './group/ownership';

// Group auto-scale
export {
    calculateGroupBounds,
    needsExpansion,
    scaleGroupToFitChild,
    updateGroupSize,
    recursiveGroupScale,
    applyGroupScales,
    autoScaleGroups,
    isChildWithinBounds,
    getGroupsNeedingScale,
    shrinkGroupsToFit,
    recursiveShrinkGroups,
} from './group/auto-scale';

// Collision detection
export {
    detectCollision,
    detectAllCollisions,
    detectCollisionsForNode,
    hasCollisions,
    getCollidingNodes,
} from './collision/detector';

// Collision resolution
export {
    resolveCollisions,
    applyResolution,
    resolveExpansionCollisions,
    pushNodeAway,
    simpleResolve,
} from './collision/resolver';

// Main hook
export { useLayoutManager } from './hooks/useLayoutManager';
export type { UseLayoutManagerReturn } from './hooks/useLayoutManager';

// Grid relayout
export { relayoutToGrid } from './grid/relayout';

// Auto-insert (for nodes added by Python backend or frontend actions)
export {
    NEEDS_LAYOUT_POSITION,
    needsAutoLayout,
    findReferenceNode,
    findBottomY,
    calculateInsertPosition,
    chainPushRight,
    autoInsertNode,
    applyAutoInsertResult,
    processAutoLayoutNodes,
} from './auto-insert';
export type { AutoInsertResult } from './auto-insert';
