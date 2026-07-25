from __future__ import annotations

import importlib.util
import platform
import shutil
from pathlib import Path


def module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return name in __import__("sys").modules


def require_apple_silicon() -> None:
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("This MLX model requires an Apple Silicon Mac")


def require_cache_dir(cache_dir: str | None) -> Path:
    if not cache_dir:
        raise ValueError("cache_dir is required for managed MLX models")
    root = Path(cache_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def cached_snapshot(model: str, cache_dir: str | None) -> Path | None:
    explicit = Path(model).expanduser()
    if explicit.exists():
        return explicit.resolve()
    if not module_available("huggingface_hub"):
        return None
    from huggingface_hub import snapshot_download

    try:
        return Path(snapshot_download(
            repo_id=model,
            cache_dir=str(require_cache_dir(cache_dir)),
            local_files_only=True,
        )).resolve()
    except Exception:
        return None


def require_cached_snapshot(model: str, cache_dir: str | None) -> Path:
    snapshot = cached_snapshot(model, cache_dir)
    if snapshot is None:
        raise RuntimeError(f"MLX model {model} is not downloaded")
    return snapshot


def download_snapshot(model: str, cache_dir: str | None) -> Path:
    from huggingface_hub import snapshot_download

    return Path(snapshot_download(
        repo_id=model,
        cache_dir=str(require_cache_dir(cache_dir)),
    )).resolve()


def remove_snapshot(model: str, cache_dir: str | None) -> None:
    explicit = Path(model).expanduser()
    if explicit.exists():
        raise ValueError("Refusing to remove an explicit local model path")
    root = require_cache_dir(cache_dir)
    snapshot = cached_snapshot(model, cache_dir)
    if snapshot is None:
        return

    repo_dir: Path | None = None
    for candidate in (snapshot, *snapshot.parents):
        if candidate == root:
            break
        if candidate.name.startswith("models--") and root in candidate.parents:
            repo_dir = candidate
            break
    target = repo_dir or snapshot
    if target == root or root not in target.parents:
        raise ValueError("Refusing to remove a model outside the managed cache")
    shutil.rmtree(target, ignore_errors=True)


__all__ = [
    "cached_snapshot",
    "download_snapshot",
    "module_available",
    "remove_snapshot",
    "require_apple_silicon",
    "require_cached_snapshot",
    "require_cache_dir",
]
