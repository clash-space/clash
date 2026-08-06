import importlib
import importlib.util
import io
import json
import sys
import types
from pathlib import Path

SDK_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SDK_DIR))

from clash_sdk.local_models import (
    LocalAsrSegment,
    LocalAsrTranscription,
    LocalAsrWord,
    LocalModelStatus,
    LocalTtsSynthesis,
    handle_local_model_rpc,
)
from clash_sdk.local_models.funasr import FunAsrLocalAsrRuntime
from clash_sdk.local_models.piper import PiperLocalTtsRuntime
from clash_sdk.local_models.whisper import WhisperLocalAsrRuntime
from clash_sdk.local_models.kokoro import KokoroLocalTtsRuntime
from clash_sdk.local_models.vibevoice import VibeVoiceLocalAsrRuntime
from clash_sdk.local_models.asr import RoutedLocalAsrRuntime
from clash_sdk.local_models.tts import RoutedLocalTtsRuntime


def _parakeet_runtime_type():
    spec = importlib.util.find_spec("clash_sdk.local_models.parakeet")
    assert spec is not None, "Parakeet must have a dedicated MLX-Audio adapter"
    module = importlib.import_module("clash_sdk.local_models.parakeet")
    return module, module.ParakeetLocalAsrRuntime


class FakeAsrRuntime:
    def __init__(self):
        self.calls = []

    def status(self, model: str):
        self.calls.append(("status", model))
        return LocalModelStatus(available=True)

    def deploy(self, model: str, kind: str = "asr"):
        self.calls.append(("deploy", model, kind))
        return None

    def transcribe(self, model: str, audio_path: str, language: str | None = None):
        self.calls.append(("transcribe", model, audio_path, language))
        return LocalAsrTranscription(
            text="你好 local",
            backend_id="fixture-asr",
            model_id=model,
            language=language,
            duration_ms=500,
            words=[
                LocalAsrWord(id="word-000001", text="你好", start_ms=0, end_ms=240),
                LocalAsrWord(id="word-000002", text="local", start_ms=260, end_ms=500),
            ],
            segments=[
                LocalAsrSegment(
                    id="segment-000001",
                    text="你好 local",
                    start_ms=0,
                    end_ms=500,
                    word_ids=["word-000001", "word-000002"],
                ),
            ],
        )


def test_local_model_rpc_dispatches_to_runtime_contract():
    runtime = FakeAsrRuntime()

    assert handle_local_model_rpc(runtime, {"method": "status", "params": {"model": "iic/SenseVoiceSmall"}}) == {
        "ok": True,
        "result": {"available": True},
    }
    assert handle_local_model_rpc(runtime, {"method": "deploy", "params": {"model": "iic/SenseVoiceSmall", "kind": "asr"}}) == {
        "ok": True,
        "result": {},
    }
    assert handle_local_model_rpc(
        runtime,
        {
            "method": "transcribe",
            "params": {"model": "iic/SenseVoiceSmall", "audio_path": "/tmp/input.webm", "language": "zh"},
        },
    ) == {
        "ok": True,
        "result": {
            "schemaVersion": 1,
            "kind": "clash.asr.timed-transcript",
            "timebase": "milliseconds",
            "alignment": "word",
            "text": "你好 local",
            "backendId": "fixture-asr",
            "modelId": "iic/SenseVoiceSmall",
            "language": "zh",
            "durationMs": 500,
            "words": [
                {"id": "word-000001", "text": "你好", "startMs": 0, "endMs": 240},
                {"id": "word-000002", "text": "local", "startMs": 260, "endMs": 500},
            ],
            "segments": [
                {
                    "id": "segment-000001",
                    "text": "你好 local",
                    "startMs": 0,
                    "endMs": 500,
                    "wordIds": ["word-000001", "word-000002"],
                },
            ],
        },
    }

    assert runtime.calls == [
        ("status", "iic/SenseVoiceSmall"),
        ("deploy", "iic/SenseVoiceSmall", "asr"),
        ("transcribe", "iic/SenseVoiceSmall", "/tmp/input.webm", "zh"),
    ]


def test_local_model_rpc_returns_structured_errors():
    class BrokenAsrRuntime(FakeAsrRuntime):
        def status(self, model: str):
            raise RuntimeError("missing funasr")

    assert handle_local_model_rpc(BrokenAsrRuntime(), {"method": "status", "params": {"model": "x"}}) == {
        "ok": False,
        "error": "missing funasr",
    }


def test_local_model_rpc_dispatches_tts_lifecycle_and_synthesis():
    class FakeTtsRuntime:
        def __init__(self):
            self.calls = []

        def status(self, model: str, cache_dir: str | None = None):
            self.calls.append(("status", model, cache_dir))
            return LocalModelStatus(available=True)

        def deploy(self, model: str, kind: str = "tts", cache_dir: str | None = None):
            self.calls.append(("deploy", model, kind, cache_dir))

        def remove(self, model: str, cache_dir: str | None = None):
            self.calls.append(("remove", model, cache_dir))

        def synthesize(
            self,
            model: str,
            text: str,
            output_path: str,
            cache_dir: str | None = None,
            voice: str | None = None,
            speed: float | None = None,
        ):
            self.calls.append(("synthesize", model, text, output_path, cache_dir, voice, speed))
            return LocalTtsSynthesis(
                backend_id="fixture-tts",
                model_id=model,
                voice_id=voice,
                sample_rate=22050,
                duration_ms=1280,
                output_path=output_path,
            )

    runtime = FakeTtsRuntime()
    cache_dir = "/tmp/clash-speech-models"
    assert handle_local_model_rpc(
        runtime,
        {"method": "status", "params": {"model": "zh_CN-huayan-medium", "cache_dir": cache_dir}},
    ) == {"ok": True, "result": {"available": True}}
    assert handle_local_model_rpc(
        runtime,
        {
            "method": "deploy",
            "params": {"model": "zh_CN-huayan-medium", "kind": "tts", "cache_dir": cache_dir},
        },
    ) == {"ok": True, "result": {}}
    assert handle_local_model_rpc(
        runtime,
        {
            "method": "synthesize",
            "params": {
                "model": "zh_CN-huayan-medium",
                "text": "Clash 本地语音",
                "output_path": "/tmp/clash-output.wav",
                "cache_dir": cache_dir,
                "voice": "huayan",
                "speed": 1.1,
            },
        },
    ) == {
        "ok": True,
        "result": {
            "schemaVersion": 1,
            "kind": "clash.tts.audio",
            "backendId": "fixture-tts",
            "modelId": "zh_CN-huayan-medium",
            "voiceId": "huayan",
            "format": "wav",
            "sampleRate": 22050,
            "durationMs": 1280,
            "outputPath": "/tmp/clash-output.wav",
        },
    }
    assert handle_local_model_rpc(
        runtime,
        {"method": "remove", "params": {"model": "zh_CN-huayan-medium", "cache_dir": cache_dir}},
    ) == {"ok": True, "result": {}}
    assert runtime.calls == [
        ("status", "zh_CN-huayan-medium", cache_dir),
        ("deploy", "zh_CN-huayan-medium", "tts", cache_dir),
        (
            "synthesize",
            "zh_CN-huayan-medium",
            "Clash 本地语音",
            "/tmp/clash-output.wav",
            cache_dir,
            "huayan",
            1.1,
        ),
        ("remove", "zh_CN-huayan-medium", cache_dir),
    ]


def test_funasr_normalizes_word_timestamps_and_requests_alignment(monkeypatch):
    import funasr

    generated = []
    constructed = []

    class FakeAutoModel:
        def __init__(self, **kwargs):
            assert kwargs == {"model": "iic/SenseVoiceSmall", "trust_remote_code": True}
            constructed.append(kwargs)

        def generate(self, **kwargs):
            generated.append(kwargs)
            return [
                {
                    "text": "<|zh|><|NEUTRAL|><|Speech|><|withitn|>你好 Clash",
                    "words": ["你", "好", "Clash"],
                    "timestamp": [[40, 180], [180, 360], [420, 721]],
                },
            ]

    monkeypatch.setattr(funasr, "AutoModel", FakeAutoModel)

    runtime = FunAsrLocalAsrRuntime()
    transcription = runtime.transcribe(
        model="iic/SenseVoiceSmall",
        audio_path="/tmp/input.wav",
        language="zh",
    )
    runtime.transcribe(
        model="iic/SenseVoiceSmall",
        audio_path="/tmp/second.wav",
        language="zh",
    )

    assert transcription.text == "你好 Clash"
    assert transcription.backend_id == "funasr"
    assert transcription.model_id == "iic/SenseVoiceSmall"
    assert transcription.language == "zh"
    assert transcription.duration_ms == 721
    assert [
        (word.id, word.text, word.start_ms, word.end_ms)
        for word in transcription.words
    ] == [
        ("word-000001", "你", 40, 180),
        ("word-000002", "好", 180, 360),
        ("word-000003", "Clash", 420, 721),
    ]
    assert transcription.segments[0].word_ids == [
        "word-000001",
        "word-000002",
        "word-000003",
    ]
    assert constructed == [
        {"model": "iic/SenseVoiceSmall", "trust_remote_code": True},
    ]
    assert generated == [
        {
            "input": "/tmp/input.wav",
            "language": "zh",
            "use_itn": True,
            "batch_size_s": 60,
            "output_timestamp": True,
            "pred_timestamp": True,
        },
        {
            "input": "/tmp/second.wav",
            "language": "zh",
            "use_itn": True,
            "batch_size_s": 60,
            "output_timestamp": True,
            "pred_timestamp": True,
        },
    ]


def test_funasr_status_distinguishes_installed_runtime_from_downloaded_model(monkeypatch):
    snapshot_module = importlib.import_module("modelscope.hub.snapshot_download")

    def missing_model(*args, **kwargs):
        assert kwargs["local_files_only"] is True
        raise ValueError("not cached")

    monkeypatch.setattr(snapshot_module, "snapshot_download", missing_model)

    status = FunAsrLocalAsrRuntime().status("iic/not-downloaded")

    assert status.available is False
    assert "not downloaded" in (status.message or "")


def test_funasr_removes_only_the_managed_cached_model(tmp_path, monkeypatch):
    snapshot_module = importlib.import_module("modelscope.hub.snapshot_download")

    cached_model = tmp_path / "managed-model"
    cached_model.mkdir()
    (cached_model / "model.bin").write_bytes(b"fixture")

    def cached_snapshot(model, **kwargs):
        assert model == "iic/SenseVoiceSmall"
        assert kwargs["local_files_only"] is True
        return str(cached_model)

    monkeypatch.setattr(snapshot_module, "snapshot_download", cached_snapshot)

    FunAsrLocalAsrRuntime().remove("iic/SenseVoiceSmall")

    assert cached_model.exists() is False


def test_piper_runtime_downloads_to_managed_cache_and_synthesizes_wav(tmp_path, monkeypatch):
    model = "zh_CN-huayan-medium"
    model_path = tmp_path / f"{model}.onnx"
    config_path = tmp_path / f"{model}.onnx.json"
    downloads = []
    synthesized = []
    loaded = []

    def fake_check_call(command):
        downloads.append(command)
        model_path.write_bytes(b"onnx")
        config_path.write_text("{}", encoding="utf-8")

    class FakeVoice:
        def synthesize_wav(self, text, wav_file, syn_config=None):
            synthesized.append((text, syn_config.length_scale))
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(22050)
            wav_file.writeframes(b"\x00\x00" * 2205)

    class FakeSynthesisConfig:
        def __init__(self, *, length_scale):
            self.length_scale = length_scale

    def fake_load_voice(path):
        loaded.append(path)
        return FakeVoice()

    fake_piper = types.ModuleType("piper")
    fake_piper.PiperVoice = types.SimpleNamespace(load=fake_load_voice)
    fake_piper.SynthesisConfig = FakeSynthesisConfig
    monkeypatch.setitem(sys.modules, "piper", fake_piper)
    original_find_spec = importlib.util.find_spec
    monkeypatch.setattr(
        importlib.util,
        "find_spec",
        lambda name: object() if name == "piper" else original_find_spec(name),
    )
    monkeypatch.setattr("subprocess.check_call", fake_check_call)

    runtime = PiperLocalTtsRuntime()
    assert runtime.status(model, str(tmp_path)).available is False
    runtime.deploy(model, "tts", str(tmp_path))
    assert runtime.status(model, str(tmp_path)).available is True

    output_path = tmp_path / "speech.wav"
    result = runtime.synthesize(
        model=model,
        text="Clash 本地语音",
        output_path=str(output_path),
        cache_dir=str(tmp_path),
        voice="huayan",
        speed=1.25,
    )
    runtime.synthesize(
        model=model,
        text="第二次调用",
        output_path=str(output_path),
        cache_dir=str(tmp_path),
        voice="huayan",
        speed=1.25,
    )

    assert downloads == [
        [sys.executable, "-m", "pip", "install", "-U", "piper-tts[zh]"],
        [
            sys.executable,
            "-m",
            "piper.download_voices",
            "--data-dir",
            str(tmp_path),
            model,
        ],
    ]
    assert loaded == [str(model_path)]
    assert synthesized == [("Clash 本地语音", 0.8), ("第二次调用", 0.8)]
    assert output_path.exists()
    assert result.backend_id == "piper"
    assert result.model_id == model
    assert result.voice_id == "huayan"
    assert result.sample_rate == 22050
    assert result.duration_ms == 100

    runtime.remove(model, str(tmp_path))
    assert model_path.exists() is False
    assert config_path.exists() is False


def test_routed_local_speech_runtime_selects_the_adapter_from_the_model_id():
    class FakeRuntime:
        def __init__(self, name):
            self.name = name
            self.calls = []

        def status(self, model, cache_dir=None):
            self.calls.append(("status", model, cache_dir))
            return LocalModelStatus(available=True, message=self.name)

    funasr = FakeRuntime("funasr")
    whisper = FakeRuntime("whisper")
    parakeet = FakeRuntime("parakeet")
    vibevoice = FakeRuntime("vibevoice")
    piper = FakeRuntime("piper")
    kokoro = FakeRuntime("kokoro")

    asr = RoutedLocalAsrRuntime(
        funasr_runtime=funasr,
        whisper_runtime=whisper,
        parakeet_runtime=parakeet,
        vibevoice_runtime=vibevoice,
    )
    tts = RoutedLocalTtsRuntime(piper_runtime=piper, kokoro_runtime=kokoro)

    assert asr.status("iic/SenseVoiceSmall", "/cache").message == "funasr"
    assert asr.status("mlx-community/whisper-small-mlx", "/cache").message == "whisper"
    assert asr.status("mlx-community/parakeet-tdt-0.6b-v3", "/cache").message == "parakeet"
    assert asr.status("mlx-community/VibeVoice-ASR-4bit", "/cache").message == "vibevoice"
    assert tts.status("en_US-lessac-medium", "/cache").message == "piper"
    assert tts.status("mlx-community/Kokoro-82M-4bit", "/cache").message == "kokoro"


def test_mlx_whisper_normalizes_real_word_timestamps(tmp_path, monkeypatch):
    import clash_sdk.local_models.whisper as whisper_module

    calls = []
    fake_mlx_whisper = types.ModuleType("mlx_whisper")

    def fake_transcribe(audio_path, **kwargs):
        calls.append((audio_path, kwargs))
        return {
            "text": "Hello 世界",
            "language": "en",
            "segments": [
                {
                    "start": 0.1,
                    "end": 1.25,
                    "text": "Hello 世界",
                    "words": [
                        {"word": " Hello", "start": 0.1, "end": 0.55, "probability": 0.97},
                        {"word": " 世界", "start": 0.62, "end": 1.25, "probability": 0.91},
                    ],
                },
            ],
        }

    fake_mlx_whisper.transcribe = fake_transcribe
    monkeypatch.setitem(sys.modules, "mlx_whisper", fake_mlx_whisper)
    monkeypatch.setattr(
        whisper_module,
        "_require_cached_snapshot",
        lambda model, cache_dir: tmp_path / "whisper-small",
    )

    result = WhisperLocalAsrRuntime().transcribe(
        model="mlx-community/whisper-small-mlx",
        audio_path="/tmp/input.wav",
        language="en",
        cache_dir=str(tmp_path),
    )

    assert result.backend_id == "mlx-whisper"
    assert result.text == "Hello 世界"
    assert result.duration_ms == 1250
    assert [(word.text, word.start_ms, word.end_ms, word.confidence) for word in result.words] == [
        ("Hello", 100, 550, 0.97),
        ("世界", 620, 1250, 0.91),
    ]
    assert calls == [
        (
            "/tmp/input.wav",
            {
                "path_or_hf_repo": str(tmp_path / "whisper-small"),
                "word_timestamps": True,
                "language": "en",
            },
        ),
    ]


def test_kokoro_synthesizes_a_managed_wav_with_voice_language(tmp_path, monkeypatch):
    import clash_sdk.local_models.kokoro as kokoro_module

    generated = []
    loaded = []

    class FakeKokoroModel:
        sample_rate = 24000

        def generate(self, **kwargs):
            generated.append(kwargs)
            yield types.SimpleNamespace(audio=types.SimpleNamespace(tolist=lambda: [0.0, 0.5, -0.5, 0.0]))

    def fake_load_model(path):
        loaded.append(path)
        return FakeKokoroModel()

    fake_utils = types.ModuleType("mlx_audio.tts.utils")
    fake_utils.load_model = fake_load_model
    monkeypatch.setitem(sys.modules, "mlx_audio", types.ModuleType("mlx_audio"))
    monkeypatch.setitem(sys.modules, "mlx_audio.tts", types.ModuleType("mlx_audio.tts"))
    monkeypatch.setitem(sys.modules, "mlx_audio.tts.utils", fake_utils)
    monkeypatch.setattr(
        kokoro_module,
        "_require_cached_snapshot",
        lambda model, cache_dir: tmp_path / "kokoro",
    )

    output = tmp_path / "kokoro.wav"
    runtime = KokoroLocalTtsRuntime()
    result = runtime.synthesize(
        model="mlx-community/Kokoro-82M-4bit",
        text="你好 Clash",
        output_path=str(output),
        cache_dir=str(tmp_path),
        voice="zf_xiaobei",
        speed=1.1,
    )
    runtime.synthesize(
        model="mlx-community/Kokoro-82M-4bit",
        text="再次生成",
        output_path=str(output),
        cache_dir=str(tmp_path),
        voice="zf_xiaobei",
        speed=1.1,
    )

    assert output.is_file()
    assert result.backend_id == "mlx-kokoro"
    assert result.voice_id == "zf_xiaobei"
    assert result.sample_rate == 24000
    assert loaded == [str(tmp_path / "kokoro")]
    assert generated == [
        {"text": "你好 Clash", "voice": "zf_xiaobei", "speed": 1.1, "lang_code": "z"},
        {"text": "再次生成", "voice": "zf_xiaobei", "speed": 1.1, "lang_code": "z"},
    ]


def test_vibevoice_combines_speaker_segments_with_whisper_word_alignment(tmp_path, monkeypatch):
    import clash_sdk.local_models.vibevoice as vibevoice_module

    class FakeWhisperRuntime:
        def transcribe(self, model, audio_path, language=None, cache_dir=None):
            assert model == "mlx-community/whisper-small-mlx"
            assert cache_dir == str(tmp_path)
            return LocalAsrTranscription(
                text="Hello there General Kenobi",
                backend_id="mlx-whisper",
                model_id=model,
                language=language,
                duration_ms=2200,
                words=[
                    LocalAsrWord(id="word-000001", text="Hello", start_ms=100, end_ms=400),
                    LocalAsrWord(id="word-000002", text="there", start_ms=450, end_ms=800),
                    LocalAsrWord(id="word-000003", text="General", start_ms=1200, end_ms=1600),
                    LocalAsrWord(id="word-000004", text="Kenobi", start_ms=1650, end_ms=2100),
                ],
                segments=[],
            )

    class FakeVibeVoiceModel:
        def generate(self, audio, **kwargs):
            assert audio == "/tmp/meeting.wav"
            return types.SimpleNamespace(segments=[
                {"start_time": 0.0, "end_time": 1.0, "speaker_id": 0, "text": "Hello there"},
                {"start_time": 1.0, "end_time": 2.2, "speaker_id": 1, "text": "General Kenobi"},
            ])

    loaded = []

    def fake_load(path):
        loaded.append(path)
        return FakeVibeVoiceModel()

    fake_utils = types.ModuleType("mlx_audio.stt.utils")
    fake_utils.load = fake_load
    monkeypatch.setitem(sys.modules, "mlx_audio", types.ModuleType("mlx_audio"))
    monkeypatch.setitem(sys.modules, "mlx_audio.stt", types.ModuleType("mlx_audio.stt"))
    monkeypatch.setitem(sys.modules, "mlx_audio.stt.utils", fake_utils)
    monkeypatch.setattr(
        vibevoice_module,
        "_require_cached_snapshot",
        lambda model, cache_dir: tmp_path / "vibevoice",
    )

    runtime = VibeVoiceLocalAsrRuntime(whisper_runtime=FakeWhisperRuntime())
    result = runtime.transcribe(
        model="mlx-community/VibeVoice-ASR-4bit",
        audio_path="/tmp/meeting.wav",
        language="en",
        cache_dir=str(tmp_path),
    )
    runtime.transcribe(
        model="mlx-community/VibeVoice-ASR-4bit",
        audio_path="/tmp/meeting.wav",
        language="en",
        cache_dir=str(tmp_path),
    )

    assert result.backend_id == "mlx-vibevoice+mlx-whisper"
    assert [word.speaker_id for word in result.words] == ["speaker-1", "speaker-1", "speaker-2", "speaker-2"]
    assert [(segment.speaker_id, segment.word_ids) for segment in result.segments] == [
        ("speaker-1", ["word-000001", "word-000002"]),
        ("speaker-2", ["word-000003", "word-000004"]),
    ]
    assert loaded == [str(tmp_path / "vibevoice")]


def test_parakeet_merges_aligned_subword_tokens_into_true_word_timings(tmp_path, monkeypatch):
    parakeet_module, runtime_type = _parakeet_runtime_type()
    load_calls = []
    generate_calls = []

    result = types.SimpleNamespace(
        text="Hello world! Bonjour.",
        sentences=[
            types.SimpleNamespace(
                text="Hello world!",
                tokens=[
                    types.SimpleNamespace(text=" Hel", start=0.10, duration=0.12, end=0.22),
                    types.SimpleNamespace(text="lo", start=0.25, duration=0.30, end=0.55),
                    types.SimpleNamespace(text=" world", start=0.62, duration=0.30, end=0.92),
                    types.SimpleNamespace(text="!", start=0.95, duration=0.13, end=1.08),
                ],
            ),
            types.SimpleNamespace(
                text="Bonjour.",
                tokens=[
                    types.SimpleNamespace(text=" Bon", start=1.40, duration=0.22, end=1.62),
                    types.SimpleNamespace(text="jour", start=1.65, duration=0.35, end=2.00),
                    types.SimpleNamespace(text=".", start=2.00, duration=0.05, end=2.05),
                ],
            ),
        ],
    )

    class FakeParakeetModel:
        def generate(self, audio):
            generate_calls.append(audio)
            return result

    fake_utils = types.ModuleType("mlx_audio.stt.utils")

    def fake_load(path):
        load_calls.append(path)
        return FakeParakeetModel()

    fake_utils.load = fake_load
    monkeypatch.setitem(sys.modules, "mlx_audio", types.ModuleType("mlx_audio"))
    monkeypatch.setitem(sys.modules, "mlx_audio.stt", types.ModuleType("mlx_audio.stt"))
    monkeypatch.setitem(sys.modules, "mlx_audio.stt.utils", fake_utils)
    monkeypatch.setattr(
        parakeet_module,
        "_require_cached_snapshot",
        lambda model, cache_dir: tmp_path / "parakeet",
    )

    runtime = runtime_type()
    transcription = runtime.transcribe(
        model="mlx-community/parakeet-tdt-0.6b-v3",
        audio_path="/tmp/european-interview.wav",
        language="fr",
        cache_dir=str(tmp_path),
    )
    runtime.transcribe(
        model="mlx-community/parakeet-tdt-0.6b-v3",
        audio_path="/tmp/second-interview.wav",
        language="fr",
        cache_dir=str(tmp_path),
    )

    assert transcription.backend_id == "mlx-parakeet"
    assert transcription.model_id == "mlx-community/parakeet-tdt-0.6b-v3"
    assert transcription.language == "fr"
    assert transcription.text == "Hello world! Bonjour."
    assert transcription.duration_ms == 2050
    assert [(word.text, word.start_ms, word.end_ms) for word in transcription.words] == [
        ("Hello", 100, 550),
        ("world!", 620, 1080),
        ("Bonjour.", 1400, 2050),
    ]
    assert [segment.word_ids for segment in transcription.segments] == [
        ["word-000001", "word-000002"],
        ["word-000003"],
    ]
    assert load_calls == [str(tmp_path / "parakeet")]
    assert generate_calls == ["/tmp/european-interview.wav", "/tmp/second-interview.wav"]


def test_parakeet_manages_mlx_audio_and_the_hugging_face_snapshot(tmp_path, monkeypatch):
    parakeet_module, runtime_type = _parakeet_runtime_type()
    model = "mlx-community/parakeet-tdt-0.6b-v3"
    snapshot = tmp_path / "snapshot"
    state = {"downloaded": False}
    pip_calls = []
    platform_checks = []
    removals = []

    monkeypatch.setattr(parakeet_module, "_module_available", lambda name: name == "mlx_audio")

    def require_cached_snapshot(requested_model, cache_dir):
        assert requested_model == model
        assert cache_dir == str(tmp_path)
        if not state["downloaded"]:
            raise RuntimeError(f"MLX model {model} is not downloaded")
        return snapshot

    def download_snapshot(requested_model, cache_dir):
        assert requested_model == model
        assert cache_dir == str(tmp_path)
        state["downloaded"] = True
        return snapshot

    def remove_snapshot(requested_model, cache_dir):
        assert requested_model == model
        assert cache_dir == str(tmp_path)
        state["downloaded"] = False
        removals.append((requested_model, cache_dir))

    monkeypatch.setattr(parakeet_module, "_require_cached_snapshot", require_cached_snapshot)
    monkeypatch.setattr(parakeet_module, "_download_snapshot", download_snapshot)
    monkeypatch.setattr(parakeet_module, "_remove_snapshot", remove_snapshot)
    monkeypatch.setattr(parakeet_module, "_require_apple_silicon", lambda: platform_checks.append(True))
    monkeypatch.setattr(parakeet_module.subprocess, "check_call", lambda command: pip_calls.append(command))

    runtime = runtime_type()
    assert runtime.status(model, str(tmp_path)).available is False

    runtime.deploy(model, "asr", str(tmp_path))

    assert runtime.status(model, str(tmp_path)).available is True
    assert platform_checks == [True]
    assert pip_calls == [[
        sys.executable,
        "-m",
        "pip",
        "install",
        "-U",
        "mlx-audio",
        "huggingface_hub[hf_xet]",
    ]]

    runtime.remove(model, str(tmp_path))

    assert runtime.status(model, str(tmp_path)).available is False
    assert removals == [(model, str(tmp_path))]


def test_local_model_rpc_exposes_an_explicit_parakeet_adapter(monkeypatch, capsys):
    import clash_sdk.local_models.rpc as rpc_module

    calls = []

    class FakeParakeetRuntime:
        def status(self, model, cache_dir=None):
            calls.append((model, cache_dir))
            return LocalModelStatus(available=True, message="parakeet")

    monkeypatch.setattr(rpc_module, "ParakeetLocalAsrRuntime", FakeParakeetRuntime, raising=False)
    monkeypatch.setattr(sys, "argv", ["local-model-rpc", "parakeet"])
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO(json.dumps({
            "method": "status",
            "params": {
                "model": "mlx-community/parakeet-tdt-0.6b-v3",
                "cache_dir": "/tmp/clash-asr",
            },
        })),
    )

    assert rpc_module.main() == 0
    assert json.loads(capsys.readouterr().out) == {
        "ok": True,
        "result": {"available": True, "message": "parakeet"},
    }
    assert calls == [("mlx-community/parakeet-tdt-0.6b-v3", "/tmp/clash-asr")]


def test_local_model_rpc_serves_multiple_requests_with_one_runtime(monkeypatch, capsys):
    import clash_sdk.local_models.rpc as rpc_module

    constructed = []

    class FakeParakeetRuntime:
        def __init__(self):
            constructed.append(self)

        def status(self, model, cache_dir=None):
            return LocalModelStatus(available=True, message=model)

    requests = [
        {"id": "one", "method": "status", "params": {"model": "model-one"}},
        {"id": "two", "method": "status", "params": {"model": "model-two"}},
    ]
    monkeypatch.setattr(rpc_module, "ParakeetLocalAsrRuntime", FakeParakeetRuntime, raising=False)
    monkeypatch.setattr(sys, "argv", ["local-model-rpc", "parakeet"])
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO("\n".join(json.dumps(request) for request in requests)),
    )

    assert rpc_module.main() == 0
    responses = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert responses == [
        {"id": "one", "ok": True, "result": {"available": True, "message": "model-one"}},
        {"id": "two", "ok": True, "result": {"available": True, "message": "model-two"}},
    ]
    assert len(constructed) == 1


def test_local_model_rpc_router_lazily_reuses_multiple_adapter_runtimes(monkeypatch, capsys):
    import clash_sdk.local_models.rpc as rpc_module

    parakeet_runtimes = []
    piper_runtimes = []

    class FakeParakeetRuntime:
        def __init__(self):
            parakeet_runtimes.append(self)

        def status(self, model, cache_dir=None):
            return LocalModelStatus(available=True, message=f"asr:{model}")

    class FakePiperRuntime:
        def __init__(self):
            piper_runtimes.append(self)

        def status(self, model, cache_dir=None):
            return LocalModelStatus(available=True, message=f"tts:{model}")

    requests = [
        {"id": "asr-one", "adapter": "parakeet", "method": "status", "params": {"model": "asr-one"}},
        {"id": "tts-one", "adapter": "piper", "method": "status", "params": {"model": "tts-one"}},
        {"id": "asr-two", "adapter": "parakeet", "method": "status", "params": {"model": "asr-two"}},
    ]
    monkeypatch.setattr(rpc_module, "ParakeetLocalAsrRuntime", FakeParakeetRuntime, raising=False)
    monkeypatch.setattr(rpc_module, "PiperLocalTtsRuntime", FakePiperRuntime, raising=False)
    monkeypatch.setattr(sys, "argv", ["local-model-rpc", "router"])
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO("\n".join(json.dumps(request) for request in requests)),
    )

    assert rpc_module.main() == 0
    responses = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [response["result"]["message"] for response in responses] == [
        "asr:asr-one",
        "tts:tts-one",
        "asr:asr-two",
    ]
    assert len(parakeet_runtimes) == 1
    assert len(piper_runtimes) == 1
