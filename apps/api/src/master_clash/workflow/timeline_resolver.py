"""Timeline DSL Reference Resolver - Backend

Resolves assetId references to complete item data for rendering.
Symmetric with frontend VideoComposition resolver.

This module implements a reference-based timeline model where:
- Timeline items store only assetId references, not redundant src/type data
- Resolution happens dynamically at render time
- Asset data (src/type) remains single source of truth in asset nodes
"""



def resolve_timeline_dsl(timeline_dsl: dict, loro_client=None) -> dict:
    """Resolve all assetId references in timeline to complete src/type data.

    Used before backend rendering to prepare complete DSL for Remotion.
    This ensures that all timeline items have their src and type fields
    populated from the referenced asset nodes.

    Args:
        timeline_dsl: Timeline with assetId references
        loro_client: Optional Loro client to fetch asset node data.
                     If None, returns timeline as-is (assumes pre-resolved).

    Returns:
        Resolved timeline with src/type fields populated from asset nodes,
        or original timeline if loro_client is not provided.
    """
    # If no client provided, assume timeline is pre-resolved
    if not loro_client:
        return timeline_dsl

    # Fetch all nodes from Loro to resolve references
    all_nodes = loro_client.get_all_nodes()

    # Create a copy of the timeline DSL to avoid mutating the input
    resolved_dsl = {**timeline_dsl}
    resolved_tracks = []

    # Resolve each track's items
    for track in timeline_dsl.get("tracks", []):
        resolved_items = []
        for item in track.get("items", []):
            resolved_item = resolve_item(item, all_nodes)
            resolved_items.append(resolved_item)

        resolved_tracks.append({
            **track,
            "items": resolved_items
        })

    resolved_dsl["tracks"] = resolved_tracks

    # Ensure composition dimensions are present
    # These defaults match the frontend editor defaults
    resolved_dsl.setdefault("compositionWidth", 1920)
    resolved_dsl.setdefault("compositionHeight", 1080)
    resolved_dsl.setdefault("fps", 30)

    return resolved_dsl


def resolve_item(item: dict, all_nodes: dict) -> dict:
    """Resolve single timeline item's assetId to src/type/dimensions.

    If the item has an assetId, looks up the corresponding asset node
    and populates src, type, and dimension fields from the asset's data.

    Args:
        item: Timeline item potentially containing assetId reference
        all_nodes: Dictionary mapping node IDs to node data

    Returns:
        Item with src/type/dimensions resolved from asset node if assetId present,
        otherwise returns item unchanged (for solid/text items)
    """
    # Check if item references an asset
    if asset_id := item.get("assetId"):
        # Look up the asset node
        if asset := all_nodes.get(asset_id):
            asset_data = asset.get("data", {})

            # Build resolved item with all asset data needed for rendering
            resolved = {
                **item,
                "src": asset_data.get("src"),
                "type": asset.get("type"),
            }

            # Add dimension info if available
            # Videos store naturalWidth/naturalHeight directly
            if natural_width := asset_data.get("naturalWidth"):
                resolved["naturalWidth"] = natural_width
            if natural_height := asset_data.get("naturalHeight"):
                resolved["naturalHeight"] = natural_height

            # Images may store aspectRatio (e.g., "16:9") instead
            # Convert to naturalWidth/naturalHeight for consistent rendering
            if aspect_ratio := asset_data.get("aspectRatio"):
                resolved["aspectRatio"] = aspect_ratio
                # If no explicit dimensions, derive from aspectRatio
                if "naturalWidth" not in resolved and "naturalHeight" not in resolved:
                    if isinstance(aspect_ratio, str) and ":" in aspect_ratio:
                        try:
                            w, h = map(float, aspect_ratio.split(":"))
                            if w and h:
                                # Use 1920 as base width (matches frontend logic)
                                resolved["naturalWidth"] = 1920
                                resolved["naturalHeight"] = int(1920 * h / w)
                        except (ValueError, ZeroDivisionError):
                            pass

            return resolved

    # Return item as-is if:
    # - No assetId (e.g., solid/text items don't need resolution)
    # - Asset not found (fallback to existing src/type if present)
    return item
