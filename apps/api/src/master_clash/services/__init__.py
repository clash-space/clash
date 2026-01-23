"""
Services package.

Provides clean interfaces to external services:
- r2: Cloudflare R2 storage
- genai: Google GenAI (Gemini)
- kling: Kling Video AI
- generation_models: Unified model registry + dispatchers
- gemini_asr: Gemini ASR (Audio/Video Transcription)
- video_intelligence: Google Video Intelligence (Shot Detection)
- remotion_render: Remotion video rendering service
- mg_animation: Motion graphics generation via Gemini + Remotion
"""

from master_clash.services import genai, generation_models, kling, kling_kie_client, mg_animation, r2
from master_clash.services.gemini_asr import GeminiASRService
from master_clash.services.video_intelligence import VideoIntelligenceService

__all__ = [
    "r2",
    "genai",
    "kling",
    "generation_models",
    "kling_kie_client",
    "mg_animation",
    "GeminiASRService",
    "VideoIntelligenceService",
]
