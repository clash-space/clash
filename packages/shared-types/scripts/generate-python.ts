/**
 * Generate Python dataclasses from Zod schemas
 * 
 * Output goes to packages/shared-types/python/ for true monorepo sharing.
 */

import * as fs from 'fs';
import * as path from 'path';

const PYTHON_OUTPUT_DIR = path.join(__dirname, '../python/clash_types');

// Ensure output directory exists
if (!fs.existsSync(PYTHON_OUTPUT_DIR)) {
  fs.mkdirSync(PYTHON_OUTPUT_DIR, { recursive: true });
}

// Generate Python code
const generatedPy = `"""
Auto-generated type definitions from @clash/shared-types

DO NOT EDIT MANUALLY - Run 'pnpm --filter @clash/shared-types generate:python' to regenerate.
"""

from dataclasses import dataclass, field
from typing import Any, Literal


# === Enums ===

NodeStatus = Literal["idle", "pending", "generating", "completed", "failed"]
ActionType = Literal["image-gen", "video-gen"]


# === Canvas Types ===

@dataclass
class Position:
    """Canvas position coordinates."""
    x: float
    y: float


@dataclass
class NodeData:
    """Node data payload."""
    label: str | None = None
    content: str | None = None
    description: str | None = None
    prompt: str | None = None
    src: str | None = None
    url: str | None = None
    thumbnail: str | None = None
    poster: str | None = None
    status: NodeStatus | None = None
    assetId: str | None = None
    taskId: str | None = None
    actionType: ActionType | None = None
    upstreamNodeIds: list[str] = field(default_factory=list)
    duration: float | None = None
    model: str | None = None
    referenceImageUrls: list[str] = field(default_factory=list)
    error: str | None = None
    sourceNodeId: str | None = None


@dataclass
class CanvasNode:
    """Canvas node (ReactFlow compatible)."""
    id: str
    type: str
    position: Position
    data: NodeData
    parentId: str | None = None
    extent: Literal["parent"] | None = None


@dataclass
class CanvasEdge:
    """Canvas edge (ReactFlow compatible)."""
    id: str
    source: str
    target: str
    type: str = "default"
    sourceHandle: str | None = None
    targetHandle: str | None = None


# === Task Types (legacy — kept for reference) ===

@dataclass
class ModelParameter:
    id: str
    label: str
    type: str
    options: list[dict[str, Any]] | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    defaultValue: Any | None = None
    description: str | None = None
    placeholder: str | None = None


@dataclass
class ModelInputRule:
    requiresPrompt: bool = True
    referenceImage: str = "optional"
    referenceMode: str = "single"


@dataclass
class ModelCard:
    id: str
    name: str
    provider: str
    kind: str
    parameters: list[ModelParameter]
    defaultParams: dict[str, Any]
    input: ModelInputRule
    description: str | None = None


MODEL_CARDS = [
    ModelCard(
        id="nano-banana",
        name="Nano Banana",
        provider="Google Gemini",
        kind="image",
        description="Gemini 2.5 Flash image generation tuned for fast drafts.",
        parameters=[
            ModelParameter(id="aspect_ratio", label="Aspect Ratio", type="select", options=[{"label": "1:1", "value": "1:1"}, {"label": "2:3", "value": "2:3"}, {"label": "3:2", "value": "3:2"}, {"label": "3:4", "value": "3:4"}, {"label": "4:3", "value": "4:3"}, {"label": "4:5", "value": "4:5"}, {"label": "5:4", "value": "5:4"}, {"label": "9:16", "value": "9:16"}, {"label": "16:9", "value": "16:9"}, {"label": "21:9", "value": "21:9"}], defaultValue="16:9"),
            ModelParameter(id="image_size", label="Image Size", type="select", options=[{"label": "1K (Fast)", "value": "1K"}, {"label": "2K (Balanced)", "value": "2K"}, {"label": "4K (High Quality)", "value": "4K"}], defaultValue="2K", description="Higher resolution = better quality but slower generation"),
            ModelParameter(id="stylization", label="Stylization", type="slider", min=0, max=1000, step=10, defaultValue=100, description="Higher values add more model-driven styling."),
            ModelParameter(id="weirdness", label="Weirdness", type="slider", min=0, max=1000, step=10, defaultValue=0, description="Experimentation strength for unexpected details."),
            ModelParameter(id="diversity", label="Diversity", type="slider", min=0, max=1000, step=10, defaultValue=0, description="Encourage variety across multiple renders."),
            ModelParameter(id="count", label="Count", type="number", min=1, max=8, step=1, defaultValue=1, description="How many candidates to request in one call."),
        ],
        defaultParams={"aspect_ratio": "16:9", "image_size": "2K", "stylization": 100, "weirdness": 0, "diversity": 0, "count": 1},
        input=ModelInputRule(requiresPrompt=True, referenceImage="optional", referenceMode="single"),
    ),
    ModelCard(
        id="nano-banana-pro",
        name="Nano Banana Pro",
        provider="Google Gemini",
        kind="image",
        description="Gemini 3.0 Pro Image Preview for higher fidelity generations.",
        parameters=[
            ModelParameter(id="aspect_ratio", label="Aspect Ratio", type="select", options=[{"label": "1:1", "value": "1:1"}, {"label": "2:3", "value": "2:3"}, {"label": "3:2", "value": "3:2"}, {"label": "3:4", "value": "3:4"}, {"label": "4:3", "value": "4:3"}, {"label": "4:5", "value": "4:5"}, {"label": "5:4", "value": "5:4"}, {"label": "9:16", "value": "9:16"}, {"label": "16:9", "value": "16:9"}, {"label": "21:9", "value": "21:9"}], defaultValue="16:9"),
            ModelParameter(id="image_size", label="Image Size", type="select", options=[{"label": "1K (Fast)", "value": "1K"}, {"label": "2K (Balanced)", "value": "2K"}, {"label": "4K (High Quality)", "value": "4K"}], defaultValue="2K", description="Higher resolution = better quality but slower generation"),
            ModelParameter(id="stylization", label="Stylization", type="slider", min=0, max=1000, step=10, defaultValue=200),
            ModelParameter(id="weirdness", label="Weirdness", type="slider", min=0, max=1000, step=10, defaultValue=0),
            ModelParameter(id="count", label="Count", type="number", min=1, max=8, step=1, defaultValue=1, description="How many candidates to request in one call."),
        ],
        defaultParams={"aspect_ratio": "16:9", "image_size": "2K", "stylization": 200, "weirdness": 0, "count": 1},
        input=ModelInputRule(requiresPrompt=True, referenceImage="optional", referenceMode="single"),
    ),
    ModelCard(
        id="kling-image2video",
        name="Kling Image2Video",
        provider="Kling (Beijing)",
        kind="video",
        description="Turn a single keyframe into a short cinematic clip.",
        parameters=[
            ModelParameter(id="duration", label="Duration", type="select", options=[{"label": "5s", "value": 5}, {"label": "10s", "value": 10}], defaultValue=5),
            ModelParameter(id="cfg_scale", label="CFG", type="slider", min=0, max=1, step=0.05, defaultValue=0.5, description="Higher values adhere more tightly to the prompt."),
        ],
        defaultParams={"duration": 5, "cfg_scale": 0.5},
        input=ModelInputRule(requiresPrompt=True, referenceImage="required", referenceMode="single"),
    ),
    ModelCard(
        id="kling-kie-text2video",
        name="Kling Text2Video Pro",
        provider="Kling AI (KIE)",
        kind="video",
        description="Direct text-to-video generation via Kling KIE API.",
        parameters=[
            ModelParameter(id="duration", label="Duration", type="select", options=[{"label": "5s", "value": "5"}, {"label": "10s", "value": "10"}], defaultValue="5"),
            ModelParameter(id="aspect_ratio", label="Aspect Ratio", type="select", options=[{"label": "16:9", "value": "16:9"}, {"label": "9:16", "value": "9:16"}, {"label": "1:1", "value": "1:1"}], defaultValue="16:9"),
            ModelParameter(id="negative_prompt", label="Negative Prompt", type="text", placeholder="blur, distort, low quality", defaultValue="blur, distort, low quality"),
            ModelParameter(id="cfg_scale", label="CFG", type="slider", min=0, max=1, step=0.05, defaultValue=0.5),
        ],
        defaultParams={"duration": "5", "aspect_ratio": "16:9", "negative_prompt": "blur, distort, low quality", "cfg_scale": 0.5},
        input=ModelInputRule(requiresPrompt=True, referenceImage="forbidden", referenceMode="none"),
    ),
    ModelCard(
        id="kling-kie-image2video",
        name="Kling Image2Video Pro",
        provider="Kling AI (KIE)",
        kind="video",
        description="Animate a still image with Kling KIE image-to-video.",
        parameters=[
            ModelParameter(id="duration", label="Duration", type="select", options=[{"label": "5s", "value": "5"}, {"label": "10s", "value": "10"}], defaultValue="5"),
            ModelParameter(id="aspect_ratio", label="Aspect Ratio", type="select", options=[{"label": "16:9", "value": "16:9"}, {"label": "9:16", "value": "9:16"}, {"label": "1:1", "value": "1:1"}], defaultValue="16:9"),
            ModelParameter(id="negative_prompt", label="Negative Prompt", type="text", placeholder="blur, distort, low quality", defaultValue="blur, distort, low quality"),
            ModelParameter(id="cfg_scale", label="CFG", type="slider", min=0, max=1, step=0.05, defaultValue=0.5),
        ],
        defaultParams={"duration": "5", "aspect_ratio": "16:9", "negative_prompt": "blur, distort, low quality", "cfg_scale": 0.5},
        input=ModelInputRule(requiresPrompt=True, referenceImage="required", referenceMode="start_end"),
    ),
    ModelCard(
        id="minimax-tts",
        name="MiniMax TTS",
        provider="MiniMax",
        kind="audio",
        description="High-quality Chinese and English text-to-speech.",
        parameters=[
            ModelParameter(id="voice_id", label="Voice", type="select", options=[{"label": "Female - Warm", "value": "female-warm"}, {"label": "Female - Energetic", "value": "female-energetic"}, {"label": "Male - Calm", "value": "male-calm"}, {"label": "Male - Storyteller", "value": "male-storyteller"}], defaultValue="female-warm"),
            ModelParameter(id="speed", label="Speed", type="slider", min=0.5, max=2.0, step=0.1, defaultValue=1.0, description="Speech speed multiplier"),
            ModelParameter(id="pitch", label="Pitch", type="slider", min=-12, max=12, step=1, defaultValue=0, description="Voice pitch adjustment (semitones)"),
        ],
        defaultParams={"voice_id": "female-warm", "speed": 1.0, "pitch": 0},
        input=ModelInputRule(requiresPrompt=True, referenceImage="forbidden", referenceMode="none"),
    ),
    ModelCard(
        id="elevenlabs-tts",
        name="ElevenLabs TTS",
        provider="ElevenLabs",
        kind="audio",
        description="Ultra-realistic voice synthesis with emotional range.",
        parameters=[
            ModelParameter(id="voice_id", label="Voice", type="select", options=[{"label": "Rachel - Calm", "value": "rachel"}, {"label": "Drew - Professional", "value": "drew"}, {"label": "Clyde - Warm", "value": "clyde"}, {"label": "Paul - Narrator", "value": "paul"}], defaultValue="rachel"),
            ModelParameter(id="model_id", label="Model", type="select", options=[{"label": "Multilingual v2", "value": "eleven_multilingual_v2"}, {"label": "English v2", "value": "eleven_monolingual_v1"}, {"label": "Turbo v2", "value": "eleven_turbo_v2"}], defaultValue="eleven_multilingual_v2"),
            ModelParameter(id="stability", label="Stability", type="slider", min=0, max=1, step=0.05, defaultValue=0.5, description="Voice consistency (0=variable, 1=stable)"),
            ModelParameter(id="similarity_boost", label="Similarity", type="slider", min=0, max=1, step=0.05, defaultValue=0.75, description="How closely to match the original voice"),
        ],
        defaultParams={"voice_id": "rachel", "model_id": "eleven_multilingual_v2", "stability": 0.5, "similarity_boost": 0.75},
        input=ModelInputRule(requiresPrompt=True, referenceImage="forbidden", referenceMode="none"),
    ),
    ModelCard(
        id="sora-2-pro-text-to-video",
        name="Sora 2 Pro (Text)",
        provider="KIE.ai",
        kind="video",
        description="Sora 2 Pro Text-to-Video generation.",
        parameters=[
            ModelParameter(id="duration", label="Duration", type="select", options=[{"label": "5s", "value": "5"}, {"label": "10s", "value": "10"}], defaultValue="5"),
            ModelParameter(id="aspect_ratio", label="Aspect Ratio", type="select", options=[{"label": "16:9", "value": "16:9"}, {"label": "9:16", "value": "9:16"}, {"label": "1:1", "value": "1:1"}, {"label": "21:9", "value": "21:9"}], defaultValue="16:9"),
            ModelParameter(id="resolution", label="Resolution", type="select", options=[{"label": "720p", "value": "720p"}, {"label": "1080p", "value": "1080p"}], defaultValue="720p"),
            ModelParameter(id="cfg_scale", label="CFG", type="slider", min=0, max=1, step=0.05, defaultValue=0.5),
        ],
        defaultParams={"duration": "5", "aspect_ratio": "16:9", "resolution": "720p", "cfg_scale": 0.5},
        input=ModelInputRule(requiresPrompt=True, referenceImage="forbidden", referenceMode="none"),
    ),
    ModelCard(
        id="sora-2-pro-image-to-video",
        name="Sora 2 Pro (Image)",
        provider="KIE.ai",
        kind="video",
        description="Sora 2 Pro Image-to-Video generation.",
        parameters=[
            ModelParameter(id="duration", label="Duration", type="select", options=[{"label": "5s", "value": "5"}, {"label": "10s", "value": "10"}], defaultValue="5"),
            ModelParameter(id="aspect_ratio", label="Aspect Ratio", type="select", options=[{"label": "16:9", "value": "16:9"}, {"label": "9:16", "value": "9:16"}, {"label": "1:1", "value": "1:1"}, {"label": "21:9", "value": "21:9"}], defaultValue="16:9"),
            ModelParameter(id="resolution", label="Resolution", type="select", options=[{"label": "720p", "value": "720p"}, {"label": "1080p", "value": "1080p"}], defaultValue="720p"),
            ModelParameter(id="cfg_scale", label="CFG", type="slider", min=0, max=1, step=0.05, defaultValue=0.5),
        ],
        defaultParams={"duration": "5", "aspect_ratio": "16:9", "resolution": "720p", "cfg_scale": 0.5},
        input=ModelInputRule(requiresPrompt=False, referenceImage="required", referenceMode="single"),
    ),
    ModelCard(
        id="sora-2-characters",
        name="Sora 2 Characters",
        provider="KIE.ai",
        kind="video",
        description="Sora 2 Characters generation.",
        parameters=[
            ModelParameter(id="duration", label="Duration", type="select", options=[{"label": "5s", "value": "5"}, {"label": "10s", "value": "10"}], defaultValue="5"),
            ModelParameter(id="aspect_ratio", label="Aspect Ratio", type="select", options=[{"label": "16:9", "value": "16:9"}, {"label": "9:16", "value": "9:16"}, {"label": "1:1", "value": "1:1"}, {"label": "21:9", "value": "21:9"}], defaultValue="16:9"),
            ModelParameter(id="resolution", label="Resolution", type="select", options=[{"label": "720p", "value": "720p"}, {"label": "1080p", "value": "1080p"}], defaultValue="720p"),
            ModelParameter(id="cfg_scale", label="CFG", type="slider", min=0, max=1, step=0.05, defaultValue=0.5),
        ],
        defaultParams={"duration": "5", "aspect_ratio": "16:9", "resolution": "720p", "cfg_scale": 0.5},
        input=ModelInputRule(requiresPrompt=True, referenceImage="required", referenceMode="single"),
    ),
    ModelCard(
        id="sora-2-pro-storyboard",
        name="Sora 2 Pro Storyboard",
        provider="KIE.ai",
        kind="video",
        description="Sora 2 Pro Storyboard generation.",
        parameters=[
            ModelParameter(id="duration", label="Duration", type="select", options=[{"label": "5s", "value": "5"}, {"label": "10s", "value": "10"}], defaultValue="5"),
            ModelParameter(id="aspect_ratio", label="Aspect Ratio", type="select", options=[{"label": "16:9", "value": "16:9"}, {"label": "9:16", "value": "9:16"}, {"label": "1:1", "value": "1:1"}, {"label": "21:9", "value": "21:9"}], defaultValue="16:9"),
            ModelParameter(id="resolution", label="Resolution", type="select", options=[{"label": "720p", "value": "720p"}, {"label": "1080p", "value": "1080p"}], defaultValue="720p"),
            ModelParameter(id="cfg_scale", label="CFG", type="slider", min=0, max=1, step=0.05, defaultValue=0.5),
        ],
        defaultParams={"duration": "5", "aspect_ratio": "16:9", "resolution": "720p", "cfg_scale": 0.5},
        input=ModelInputRule(requiresPrompt=True, referenceImage="forbidden", referenceMode="none"),
    ),
]
`;

fs.writeFileSync(path.join(PYTHON_OUTPUT_DIR, 'types.py'), generatedPy);
console.log(`Generated: ${path.join(PYTHON_OUTPUT_DIR, 'types.py')}`);

// Create __init__.py
const initPy = `"""
Clash Types - Auto-generated from @clash/shared-types Zod schemas.

Usage:
    from clash_types import CanvasNode, CanvasEdge
"""

from clash_types.types import (
    NodeStatus,
    ActionType,
    Position,
    NodeData,
    CanvasNode,
    CanvasEdge,
    ModelCard,
    ModelParameter,
    ModelInputRule,
    MODEL_CARDS,
)

__all__ = [
    "NodeStatus",
    "ActionType",
    "Position",
    "NodeData",
    "CanvasNode",
    "CanvasEdge",
    "ModelCard",
    "ModelParameter",
    "ModelInputRule",
    "MODEL_CARDS",
]
`;

fs.writeFileSync(path.join(PYTHON_OUTPUT_DIR, '__init__.py'), initPy);
console.log(`Generated: ${path.join(PYTHON_OUTPUT_DIR, '__init__.py')}`);

console.log('\n✅ Python type generation complete');
console.log('Install with: pip install -e packages/shared-types/python');
