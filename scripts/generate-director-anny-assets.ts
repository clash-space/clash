#!/usr/bin/env tsx

/**
 * Rebuild the Director Stage body assets from NAVER Anny 0.5.
 *
 * The Python environment must contain Anny at the pinned source revision plus
 * its `warp` extra. Example:
 *
 *   uv venv --python 3.11 .tmp/anny-venv
 *   uv pip install --python .tmp/anny-venv/bin/python \
 *     "anny[warp] @ git+https://github.com/naver/anny.git@e53d4b8a6ce4e8b5f257c4cee92cffcfb3d3efb9"
 *   pnpm assets:director:anny -- --python .tmp/anny-venv/bin/python
 *
 * Anny inference runs only during this build step. The product ships compact,
 * texture-free GLBs and has no Python or PyTorch runtime dependency.
 */

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const bodyTypes = [
  "neutral",
  "masculine",
  "feminine",
  "broad",
  "athletic",
  "slender",
  "youth",
  "child",
  "chibi",
] as const;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const python = option("--python") ?? process.env.ANNY_PYTHON ?? "python3";
const outputDirectory = path.resolve(
  option("--output") ?? "packages/director-ui/assets/anny-mpfb2",
);
mkdirSync(outputDirectory, { recursive: true });

// Kept inline so the repository follows its TypeScript-only executable rule
// while the bridge can call Anny's native Python API without an intermediate
// checked-in Python shim.
const pythonBridge = String.raw`
import json
import struct
import sys
from importlib.metadata import version
from pathlib import Path

import anny
import numpy as np
import torch
import trimesh.graph

if version("anny") != "0.5":
    raise RuntimeError("Director assets require Anny 0.5")

PRESETS = {
    "neutral": dict(gender=0.5, age=0.67, muscle=0.5, weight=0.5, height=0.5, proportions=0.5),
    "masculine": dict(gender=0.05, age=0.67, muscle=0.58, weight=0.48, height=0.57, proportions=0.5),
    "feminine": dict(gender=0.95, age=0.67, muscle=0.4, weight=0.44, height=0.48, proportions=0.5),
    "broad": dict(gender=0.35, age=0.67, muscle=0.22, weight=0.68, height=0.52, proportions=0.4),
    "athletic": dict(gender=0.35, age=0.67, muscle=0.9, weight=0.42, height=0.59, proportions=0.55),
    "slender": dict(gender=0.65, age=0.67, muscle=0.28, weight=0.34, height=0.56, proportions=0.65),
    "youth": dict(gender=0.5, age=0.52, muscle=0.34, weight=0.36, height=0.48, proportions=0.5),
    "child": dict(gender=0.5, age=0.33, muscle=0.2, weight=0.34, height=0.45, proportions=0.5),
    "chibi": dict(gender=0.5, age=0.02, muscle=0.18, weight=0.5, height=0.28, proportions=0.12),
}

DEFAULT_BODY_SHAPE_RANGE = (0.18, 0.92)
BODY_SHAPE_RANGES = {
    "youth": (0.24, 0.78),
    "child": (0.28, 0.72),
    "chibi": (0.32, 0.68),
}

def align4(data):
    while len(data) % 4:
        data.append(0)

def geometry_from_output(output, faces):
    vertices = output["rest_vertices"][0].detach().cpu().numpy().astype(np.float32)
    rotate = np.array([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ])
    vertices_h = np.concatenate([vertices, np.ones((len(vertices), 1), dtype=np.float32)], axis=1)
    vertices = (rotate @ vertices_h.T).T[:, :3].astype(np.float32)
    floor_offset = -float(vertices[:, 1].min())
    vertices[:, 1] += floor_offset

    normals = np.zeros_like(vertices)
    p0, p1, p2 = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]
    face_normals = np.cross(p1 - p0, p2 - p0)
    for corner in range(3):
        np.add.at(normals, faces[:, corner], face_normals)
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.divide(normals, lengths, out=np.zeros_like(normals), where=lengths > 0).astype(np.float32)
    return vertices, normals, rotate, floor_offset

def clean_skinning_islands(weights, joints, faces, bone_count):
    """Keep one connected body-shell influence region per bone.

    Anny's built-in cleanup asserts when the no-eyes/no-tongue topology leaves
    a vertex with no influence. Preserve that vertex's original weights while
    applying the same connected-component cleanup everywhere else.
    """
    original_weights = weights.copy()
    edges = np.concatenate([
        faces[:, [0, 1]],
        faces[:, [1, 2]],
        faces[:, [2, 0]],
    ], axis=0)
    mesh_components = trimesh.graph.connected_components(edges=edges)
    body_vertices = max(mesh_components, key=len)
    body_mask = np.zeros(len(weights), dtype=bool)
    body_mask[body_vertices] = True

    for bone_id in range(bone_count):
        bone_mask = np.any((joints == bone_id) & (weights > 0), axis=1) & body_mask
        skinned_nodes = np.flatnonzero(bone_mask)
        if len(skinned_nodes) == 0:
            continue
        components = trimesh.graph.connected_components(edges=edges, nodes=skinned_nodes)
        if len(components) <= 1:
            continue
        keep = max(components, key=len)
        drop_mask = bone_mask.copy()
        drop_mask[keep] = False
        weights[(joints == bone_id) & drop_mask[:, None]] = 0

    row_sums = weights.sum(axis=1, keepdims=True)
    empty_rows = row_sums[:, 0] <= 0
    weights[empty_rows] = original_weights[empty_rows]
    row_sums = weights.sum(axis=1, keepdims=True)
    return np.divide(weights, row_sums, out=np.zeros_like(weights), where=row_sums > 0), joints

def repair_mirrored_skinning(weights, joints, vertices, bone_labels):
    """Collapse cross-body Mixamo weights onto the anatomically correct side."""
    vertex_count = len(weights)
    bone_count = len(bone_labels)
    dense = np.zeros((vertex_count, bone_count), dtype=np.float32)
    rows = np.arange(vertex_count)[:, None]
    np.add.at(dense, (rows, joints), weights)
    name_to_id = {name: index for index, name in enumerate(bone_labels)}
    left_vertices = vertices[:, 0] > 1e-5
    right_vertices = vertices[:, 0] < -1e-5

    for left_name, left_id in name_to_id.items():
        if ":Left" not in left_name:
            continue
        right_name = left_name.replace(":Left", ":Right", 1)
        right_id = name_to_id.get(right_name)
        if right_id is None:
            continue
        dense[left_vertices, left_id] += dense[left_vertices, right_id]
        dense[left_vertices, right_id] = 0
        dense[right_vertices, right_id] += dense[right_vertices, left_id]
        dense[right_vertices, left_id] = 0

    slot_count = weights.shape[1]
    order = np.argsort(dense, axis=1)[:, -slot_count:][:, ::-1]
    repaired = np.take_along_axis(dense, order, axis=1)
    row_sums = repaired.sum(axis=1, keepdims=True)
    repaired = np.divide(repaired, row_sums, out=np.zeros_like(repaired), where=row_sums > 0)
    return repaired.astype(np.float32), order.astype(np.uint16)

def export_glb(path, model, output, preset_name, preset, shape_outputs, shape_range):
    faces = model.faces.detach().cpu().numpy().astype(np.uint32)
    vertices, normals, rotate, floor_offset = geometry_from_output(output, faces)
    weights = model.vertex_bone_weights.detach().cpu().numpy().astype(np.float32)
    joints = model.vertex_bone_indices.detach().cpu().numpy().astype(np.uint16)
    rest_bones = output["rest_bone_poses"][0].detach().cpu().numpy().astype(np.float64)
    global_transform = rotate.copy()
    global_transform[1, 3] = floor_offset

    weights, joints = repair_mirrored_skinning(weights, joints, vertices, model.bone_labels)
    weights, joints = clean_skinning_islands(weights, joints, faces, len(model.bone_labels))

    order = np.argsort(weights, axis=1)[:, -4:][:, ::-1]
    weights = np.take_along_axis(weights, order, axis=1)
    joints = np.take_along_axis(joints, order, axis=1)
    weight_sum = weights.sum(axis=1, keepdims=True)
    weights = np.divide(weights, weight_sum, out=np.zeros_like(weights), where=weight_sum > 0)

    absolute_bones = np.stack([global_transform @ pose for pose in rest_bones])
    local_bones = []
    for index, absolute in enumerate(absolute_bones):
        parent = int(model.bone_parents[index])
        local_bones.append(absolute if parent < 0 else np.linalg.inv(absolute_bones[parent]) @ absolute)
    inverse_bind = np.stack([np.linalg.inv(matrix) for matrix in absolute_bones]).astype(np.float32)

    binary = bytearray()
    buffer_views = []
    accessors = []

    def add_accessor(array, component_type, accessor_type, target=None, include_bounds=False):
        align4(binary)
        offset = len(binary)
        payload = np.ascontiguousarray(array).tobytes()
        binary.extend(payload)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
        if target is not None:
            view["target"] = target
        buffer_view = len(buffer_views)
        buffer_views.append(view)
        accessor = {
            "bufferView": buffer_view,
            "componentType": component_type,
            "count": len(array),
            "type": accessor_type,
        }
        if include_bounds:
            accessor["min"] = np.min(array, axis=0).tolist()
            accessor["max"] = np.max(array, axis=0).tolist()
        accessors.append(accessor)
        return len(accessors) - 1

    position_accessor = add_accessor(vertices, 5126, "VEC3", 34962, True)
    normal_accessor = add_accessor(normals, 5126, "VEC3", 34962)
    joints_accessor = add_accessor(joints.astype(np.uint16), 5123, "VEC4", 34962)
    weights_accessor = add_accessor(weights.astype(np.float32), 5126, "VEC4", 34962)
    index_accessor = add_accessor(faces.reshape(-1), 5125, "SCALAR", 34963)
    morph_targets = []
    for shape_output in shape_outputs:
        shape_vertices, shape_normals, _, _ = geometry_from_output(shape_output, faces)
        morph_targets.append({
            "POSITION": add_accessor((shape_vertices - vertices).astype(np.float32), 5126, "VEC3", 34962, True),
            "NORMAL": add_accessor((shape_normals - normals).astype(np.float32), 5126, "VEC3", 34962),
        })
    # glTF stores MAT4 accessors column-major; NumPy's contiguous layout is
    # row-major, so transpose each matrix before writing the binary accessor.
    inverse_bind_accessor = add_accessor(np.transpose(inverse_bind, (0, 2, 1)).copy(), 5126, "MAT4")

    joint_node_offset = 1
    nodes = [{"name": "Anny_" + preset_name, "mesh": 0, "skin": 0}]
    for index, (name, matrix) in enumerate(zip(model.bone_labels, local_bones)):
        children = [joint_node_offset + child for child, parent in enumerate(model.bone_parents) if int(parent) == index]
        node = {"name": name, "matrix": matrix.astype(np.float32).flatten(order="F").tolist()}
        if children:
            node["children"] = children
        nodes.append(node)

    document = {
        "asset": {"version": "2.0", "generator": "Clash Anny MPFB2 asset builder"},
        "scene": 0,
        "scenes": [{"nodes": [0, joint_node_offset]}],
        "nodes": nodes,
        "meshes": [{
            "name": "Anny_" + preset_name + "_Mesh",
            "primitives": [{
                "attributes": {
                    "POSITION": position_accessor,
                    "NORMAL": normal_accessor,
                    "JOINTS_0": joints_accessor,
                    "WEIGHTS_0": weights_accessor,
                },
                "indices": index_accessor,
                "material": 0,
                "targets": morph_targets,
            }],
            "weights": [0.0, 0.0],
            "extras": {"targetNames": ["Thin", "Full"]},
        }],
        "skins": [{
            "name": "Anny_Mixamo_Rig",
            "inverseBindMatrices": inverse_bind_accessor,
            "joints": list(range(joint_node_offset, joint_node_offset + len(model.bone_labels))),
            "skeleton": joint_node_offset,
        }],
        "materials": [{
            "name": "Director clean mannequin",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.913, 0.922, 0.937, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.86,
            },
            "doubleSided": False,
        }],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "extras": {
            "source": "https://github.com/naver/anny",
            "sourceVersion": "0.5",
            "sourceRevision": "e53d4b8a6ce4e8b5f257c4cee92cffcfb3d3efb9",
            "sourceTopology": "MPFB2 CC0",
            "extrapolatePhenotypes": True,
            "rig": "mixamo",
            "preset": preset_name,
            "phenotype": preset,
            "bodyShapeRange": {
                "min": -1,
                "natural": 0,
                "max": 1,
                "thinWeight": shape_range[0],
                "fullWeight": shape_range[1],
            },
        },
    }

    json_bytes = json.dumps(document, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    align4(binary)
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    glb = bytearray(struct.pack("<III", 0x46546C67, 2, total_length))
    glb.extend(struct.pack("<II", len(json_bytes), 0x4E4F534A))
    glb.extend(json_bytes)
    glb.extend(struct.pack("<II", len(binary), 0x004E4942))
    glb.extend(binary)
    path.write_bytes(glb)

output_directory = Path(sys.argv[1])
output_directory.mkdir(parents=True, exist_ok=True)
model = anny.Anny(
    rig="mixamo",
    topology="default-noeyes-notongue",
    local_changes="none",
    triangulate_faces=True,
    remove_unattached_vertices=True,
    remove_skinning_islands=False,
    extrapolate_phenotypes=True,
).to(dtype=torch.float32, device="cpu")

with torch.no_grad():
    for name, preset in PRESETS.items():
        output = model(phenotype_kwargs=preset)
        shape_range = BODY_SHAPE_RANGES.get(name, DEFAULT_BODY_SHAPE_RANGE)
        thin_preset = dict(preset, weight=shape_range[0])
        full_preset = dict(preset, weight=shape_range[1])
        shape_outputs = [
            model(phenotype_kwargs=thin_preset),
            model(phenotype_kwargs=full_preset),
        ]
        asset_path = output_directory / (name + ".glb")
        export_glb(asset_path, model, output, name, preset, shape_outputs, shape_range)
        print(name, asset_path.stat().st_size)
`;

const result = spawnSync(python, ["-c", pythonBridge, outputDirectory], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ANNY_CACHE_DIR: process.env.ANNY_CACHE_DIR ?? path.resolve(".tmp/anny-cache"),
    PYTHONHASHSEED: "0",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Anny asset generation failed with exit code ${result.status ?? "unknown"}`);
}

const missing = bodyTypes.filter(
  (bodyType) => !existsSync(path.join(outputDirectory, `${bodyType}.glb`)),
);
if (missing.length) {
  throw new Error(`Anny asset generation did not emit: ${missing.join(", ")}`);
}

console.log(`Generated ${bodyTypes.length} Anny Director Stage bodies in ${outputDirectory}`);
