import type { ProjectCanvas, ProjectTimeline, ResolvedAsset } from '@clash/shared-types';

export interface AssetRelationNode {
  id: string;
  canvasId: string;
  type?: string;
  data?: Record<string, unknown>;
}

export interface AssetRelationEdge {
  canvasId: string;
  source: string;
  target: string;
}

export interface AssetRelationGraph {
  nodes: AssetRelationNode[];
  edges: AssetRelationEdge[];
}

export interface AssetCanvasRelation {
  canvasId: string;
  canvasName: string;
  nodeId: string;
  nodeCount: number;
  role: 'origin' | 'placement' | 'reference';
}

export interface AssetTimelineRelation {
  timelineId: string;
  timelineName: string;
  itemCount: number;
}

export interface UpstreamAssetRelation {
  assetId: string;
  role: 'edit-source' | 'reference' | 'primary';
  label: string;
  asset?: ResolvedAsset;
  availableInProject: boolean;
}

export interface AssetPromptRelation {
  label: string;
  value: string;
}

export interface AssetRelationSummary {
  origin?: Omit<AssetCanvasRelation, 'nodeCount' | 'role'>;
  canvases: AssetCanvasRelation[];
  timelines: AssetTimelineRelation[];
  upstreamAssets: UpstreamAssetRelation[];
  prompts: AssetPromptRelation[];
  sourceModel?: string;
}

export interface BuildAssetRelationSummaryInput {
  assetId: string;
  asset?: ResolvedAsset;
  projectAssets: ResolvedAsset[];
  canvases: ProjectCanvas[];
  timelines: ProjectTimeline[];
  nodes: AssetRelationNode[];
  edges: AssetRelationEdge[];
}

const ACTION_NODE_TYPES = new Set([
  'action-badge',
  'image-editor',
  'video-clipper',
  'video-editor',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Project relation reads must span the whole persisted workspace, not only the
 * currently mounted React Flow canvas. Keep the CRDT shape out of Preview by
 * normalizing map entries at the feature boundary.
 */
export function readAssetRelationGraph(
  rawNodes: Iterable<unknown>,
  rawEdges: Iterable<unknown>,
): AssetRelationGraph {
  const nodes: AssetRelationNode[] = [];
  const canvasByNodeId = new Map<string, string>();

  for (const entry of rawNodes) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [id, rawNode] = entry;
    if (typeof id !== 'string' || !isRecord(rawNode)) continue;
    const canvasId = typeof rawNode.canvasId === 'string' ? rawNode.canvasId : '';
    if (!canvasId) continue;
    const node: AssetRelationNode = {
      id,
      canvasId,
      ...(typeof rawNode.type === 'string' ? { type: rawNode.type } : {}),
      ...(isRecord(rawNode.data) ? { data: rawNode.data } : {}),
    };
    nodes.push(node);
    canvasByNodeId.set(id, canvasId);
  }

  const edges: AssetRelationEdge[] = [];
  for (const entry of rawEdges) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const rawEdge = entry[1];
    if (!isRecord(rawEdge)) continue;
    const source = typeof rawEdge.source === 'string' ? rawEdge.source : '';
    const target = typeof rawEdge.target === 'string' ? rawEdge.target : '';
    if (!source || !target) continue;
    const canvasId =
      (typeof rawEdge.canvasId === 'string' ? rawEdge.canvasId : '') ||
      canvasByNodeId.get(target) ||
      canvasByNodeId.get(source) ||
      '';
    if (!canvasId) continue;
    edges.push({ canvasId, source, target });
  }

  return { nodes, edges };
}

function recordReferencesAsset(value: unknown, assetId: string, key = ''): boolean {
  if (Array.isArray(value)) {
    if (key.toLowerCase().includes('asset') && value.includes(assetId)) return true;
    return value.some((item) => recordReferencesAsset(item, assetId, key));
  }
  if (!value || typeof value !== 'object') {
    return key.toLowerCase().includes('asset') && value === assetId;
  }
  return Object.entries(value as Record<string, unknown>).some(([childKey, child]) => {
    if (childKey === 'assetId') return false;
    return recordReferencesAsset(child, assetId, childKey);
  });
}

function timelineReferenceCount(
  value: unknown,
  assetId: string,
  sourceNodeIds: Set<string>,
): number {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + timelineReferenceCount(item, assetId, sourceNodeIds), 0);
  }
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const isItem =
    record.assetId === assetId ||
    (typeof record.sourceNodeId === 'string' && sourceNodeIds.has(record.sourceNodeId));
  if (isItem) return 1;
  return Object.values(record).reduce<number>(
    (count, child) => count + timelineReferenceCount(child, assetId, sourceNodeIds),
    0,
  );
}

function assetLabel(assetId: string, asset?: ResolvedAsset): string {
  return asset?.name?.trim() || asset?.metadata.originalName?.trim() || assetId;
}

function promptLabel(key: string): string {
  if (/negative|negativ/i.test(key)) return 'Negative prompt';
  return 'Prompt';
}

function nodeHasGenerationMetadata(node: AssetRelationNode): boolean {
  return Object.keys(node.data ?? {}).some((key) =>
    /prompt|model|reference.*asset|source.*asset|input.*asset/i.test(key),
  );
}

function lineageRole(key: string): UpstreamAssetRelation['role'] {
  if (/edit/i.test(key)) return 'edit-source';
  if (/reference|ref/i.test(key)) return 'reference';
  return 'primary';
}

function collectLineageAssetIds(
  value: unknown,
  outputAssetId: string,
  path = '',
  result: Array<{ assetId: string; role: UpstreamAssetRelation['role'] }> = [],
): Array<{ assetId: string; role: UpstreamAssetRelation['role'] }> {
  if (Array.isArray(value)) {
    if (/assetids?$/i.test(path)) {
      for (const item of value) {
        if (typeof item === 'string' && item && item !== outputAssetId) {
          result.push({ assetId: item, role: lineageRole(path) });
        }
      }
      return result;
    }
    for (const item of value) collectLineageAssetIds(item, outputAssetId, path, result);
    return result;
  }
  if (!isRecord(value)) return result;
  for (const [key, child] of Object.entries(value)) {
    if (/assetid$/i.test(key) && key !== 'assetId') {
      if (typeof child === 'string' && child && child !== outputAssetId) {
        result.push({ assetId: child, role: lineageRole(key) });
      }
      continue;
    }
    collectLineageAssetIds(child, outputAssetId, key, result);
  }
  return result;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function buildAssetRelationSummary(
  input: BuildAssetRelationSummaryInput,
): AssetRelationSummary {
  const canvasById = new Map(input.canvases.map((canvas) => [canvas.id, canvas]));
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const directNodes = input.nodes.filter((node) => node.data?.assetId === input.assetId);
  const directNodeIds = new Set(directNodes.map((node) => node.id));
  const referenceNodes = input.nodes.filter(
    (node) => !directNodeIds.has(node.id) && recordReferencesAsset(node.data, input.assetId),
  );

  const originNode = directNodes.find((node) => {
    const incoming = input.edges.find(
      (edge) => edge.canvasId === node.canvasId && edge.target === node.id,
    );
    if (!incoming) return false;
    const actionNode = nodeById.get(incoming.source);
    return Boolean(
      actionNode &&
      (ACTION_NODE_TYPES.has(actionNode.type ?? '') || typeof actionNode.data?.actionType === 'string'),
    );
  }) ?? directNodes.find(nodeHasGenerationMetadata);

  const originIncomingEdge = originNode
    ? input.edges.find(
        (edge) => edge.canvasId === originNode.canvasId && edge.target === originNode.id,
      )
    : undefined;
  const originActionNode = originIncomingEdge
    ? nodeById.get(originIncomingEdge.source)
    : undefined;

  const originCanvas = originNode ? canvasById.get(originNode.canvasId) : undefined;
  const origin = originNode
    ? {
        canvasId: originNode.canvasId,
        canvasName: originCanvas?.name ?? originNode.canvasId,
        nodeId: originNode.id,
      }
    : undefined;

  const usesByCanvas = new Map<string, { direct: AssetRelationNode[]; references: AssetRelationNode[] }>();
  for (const node of directNodes) {
    const uses = usesByCanvas.get(node.canvasId) ?? { direct: [], references: [] };
    uses.direct.push(node);
    usesByCanvas.set(node.canvasId, uses);
  }
  for (const node of referenceNodes) {
    const uses = usesByCanvas.get(node.canvasId) ?? { direct: [], references: [] };
    uses.references.push(node);
    usesByCanvas.set(node.canvasId, uses);
  }

  const canvases = Array.from(usesByCanvas.entries())
    .map(([canvasId, uses]): AssetCanvasRelation => {
      const canvas = canvasById.get(canvasId);
      const isOrigin = origin?.canvasId === canvasId;
      const role = isOrigin ? 'origin' : uses.direct.length > 0 ? 'placement' : 'reference';
      const representative = isOrigin
        ? originNode
        : uses.direct[0] ?? uses.references[0];
      return {
        canvasId,
        canvasName: canvas?.name ?? canvasId,
        nodeId: representative?.id ?? '',
        nodeCount: new Set([...uses.direct, ...uses.references].map((node) => node.id)).size,
        role,
      };
    })
    .sort((left, right) => {
      const leftCanvas = canvasById.get(left.canvasId);
      const rightCanvas = canvasById.get(right.canvasId);
      return (leftCanvas?.position ?? Number.MAX_SAFE_INTEGER) -
        (rightCanvas?.position ?? Number.MAX_SAFE_INTEGER) ||
        left.canvasName.localeCompare(right.canvasName);
    });

  const timelines = input.timelines
    .map((timeline) => ({
      timelineId: timeline.id,
      timelineName: timeline.name,
      itemCount: timelineReferenceCount(timeline.state, input.assetId, directNodeIds),
    }))
    .filter((timeline) => timeline.itemCount > 0);

  const projectAssetById = new Map<string, ResolvedAsset>();
  for (const asset of input.projectAssets) {
    projectAssetById.set(asset.id, asset);
  }
  const lineageSources: Array<{ assetId: string; role: UpstreamAssetRelation['role'] }> = [
    ...collectLineageAssetIds(originNode?.data, input.assetId),
    ...collectLineageAssetIds(originActionNode?.data, input.assetId),
  ];
  if (originActionNode) {
    for (const edge of input.edges) {
      if (
        edge.canvasId !== originActionNode.canvasId ||
        edge.target !== originActionNode.id
      ) continue;
      const sourceAssetId = nodeById.get(edge.source)?.data?.assetId;
      if (typeof sourceAssetId === 'string' && sourceAssetId !== input.assetId) {
        lineageSources.push({ assetId: sourceAssetId, role: 'reference' });
      }
    }
  }
  const seenLineage = new Set<string>();
  const upstreamAssets = lineageSources.flatMap((source): UpstreamAssetRelation[] => {
    if (seenLineage.has(source.assetId)) return [];
    seenLineage.add(source.assetId);
    const asset = projectAssetById.get(source.assetId);
    return [{
      assetId: source.assetId,
      role: source.role,
      label: assetLabel(source.assetId, asset),
      asset,
      availableInProject: Boolean(asset),
    }];
  });

  const prompts: AssetPromptRelation[] = [];
  const seenPrompts = new Set<string>();
  const pushPrompt = (label: string, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const normalized = value.trim();
    if (seenPrompts.has(normalized)) return;
    seenPrompts.add(normalized);
    prompts.push({ label, value: normalized });
  };
  pushPrompt('Prompt', input.asset?.provenance?.prompt);
  if (originNode) {
    for (const [key, value] of Object.entries(originNode.data ?? {})) {
      if (/prompt/i.test(key)) pushPrompt(promptLabel(key), value);
    }
    for (const [key, value] of Object.entries(originActionNode?.data ?? {})) {
      if (/prompt/i.test(key)) pushPrompt(promptLabel(key), value);
    }
  }

  return {
    origin,
    canvases,
    timelines,
    upstreamAssets,
    prompts,
    sourceModel: firstText(
      input.asset?.provenance?.model,
      originNode?.data?.modelId,
      originNode?.data?.model,
      originActionNode?.data?.modelId,
      originActionNode?.data?.model,
    ),
  };
}
