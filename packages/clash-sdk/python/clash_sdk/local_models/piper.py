from __future__ import annotations

import importlib.util
import subprocess
import sys
import wave
from pathlib import Path

from . import LocalModelKind, LocalModelStatus, LocalTtsSynthesis


def _model_paths(model: str, cache_dir: str | None) -> tuple[Path, Path]:
    if not cache_dir:
        raise ValueError("cache_dir is required for Piper voices")
    root = Path(cache_dir).expanduser().resolve()
    return root / f"{model}.onnx", root / f"{model}.onnx.json"


class PiperLocalTtsRuntime:
    """Piper adapter behind the generic local speech runtime contract."""

    def status(self, model: str, cache_dir: str | None = None) -> LocalModelStatus:
        if importlib.util.find_spec("piper") is None:
            return LocalModelStatus(
                available=False,
                message="Piper TTS is not installed in the selected Python environment",
            )
        model_path, config_path = _model_paths(model, cache_dir)
        if not model_path.is_file() or not config_path.is_file():
            return LocalModelStatus(
                available=False,
                message=f"Piper voice {model} is not downloaded",
            )
        return LocalModelStatus(available=True)

    def deploy(
        self,
        model: str,
        kind: LocalModelKind = "tts",
        cache_dir: str | None = None,
    ) -> None:
        if kind != "tts":
            raise ValueError("Piper only supports TTS models")
        model_path, _ = _model_paths(model, cache_dir)
        model_path.parent.mkdir(parents=True, exist_ok=True)
        package = "piper-tts[zh]" if model.lower().startswith("zh_") else "piper-tts"
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-U", package])
        subprocess.check_call([
            sys.executable,
            "-m",
            "piper.download_voices",
            "--data-dir",
            str(model_path.parent),
            model,
        ])

    def remove(self, model: str, cache_dir: str | None = None) -> None:
        model_path, config_path = _model_paths(model, cache_dir)
        for path in (model_path, config_path):
            if path.exists():
                path.unlink()
        model_card = model_path.parent / "MODEL_CARD"
        if model_card.exists() and model_card.is_file():
            model_card.unlink()

    def synthesize(
        self,
        model: str,
        text: str,
        output_path: str,
        cache_dir: str | None = None,
        voice: str | None = None,
        speed: float | None = None,
    ) -> LocalTtsSynthesis:
        if not text.strip():
            raise ValueError("text is required")
        status = self.status(model, cache_dir)
        if not status.available:
            raise RuntimeError(status.message or f"Piper voice {model} is unavailable")

        from piper import PiperVoice, SynthesisConfig

        model_path, _ = _model_paths(model, cache_dir)
        output = Path(output_path).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        syn_config = SynthesisConfig(length_scale=1.0 / speed) if speed else None
        piper_voice = PiperVoice.load(str(model_path))
        with wave.open(str(output), "wb") as wav_file:
            piper_voice.synthesize_wav(text.strip(), wav_file, syn_config=syn_config)

        with wave.open(str(output), "rb") as wav_file:
            sample_rate = wav_file.getframerate()
            duration_ms = max(1, round(wav_file.getnframes() * 1000 / sample_rate))
        return LocalTtsSynthesis(
            backend_id="piper",
            model_id=model,
            voice_id=voice,
            sample_rate=sample_rate,
            duration_ms=duration_ms,
            output_path=str(output),
        )


__all__ = ["PiperLocalTtsRuntime"]
