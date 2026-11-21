"""WAV inspection with source-preserving, bounded analysis."""
import wave
from pathlib import Path
from .dsp import analyze_pcm


class AudioAnalysisError(Exception):
    """Readable error raised when an audio file cannot be analyzed."""


def analyze_wav(path: str | Path) -> dict:
    source = Path(path)
    try:
        with wave.open(str(source), "rb") as wav:
            if wav.getcomptype() != "NONE":
                raise AudioAnalysisError("圧縮されたWAVにはまだ対応していません")
            channels, rate, width = wav.getnchannels(), wav.getframerate(), wav.getsampwidth()
            frames_total = wav.getnframes()
            if not 1 <= channels <= 8:
                raise AudioAnalysisError("チャンネル数は1〜8chに対応しています")
            if width not in (1, 2, 3, 4):
                raise AudioAnalysisError("このWAVのビット深度には対応していません")
            if rate < 1000 or frames_total < 2:
                raise AudioAnalysisError("音声データが短いか、サンプルレートが不正です")
            # First milestone: analyze at most one second to bound memory and CPU.
            frames = wav.readframes(min(frames_total, rate))
            metrics = analyze_pcm(frames, rate, channels, width)
            duration = frames_total / rate
            return {
                "file_name": source.name, "format": "WAV PCM",
                "duration_seconds": duration, "sample_rate": rate,
                "channels": channels, "sample_width_bytes": width,
                "analyzed_seconds": min(duration, 1.0), **metrics,
            }
    except AudioAnalysisError:
        raise
    except (OSError, EOFError, wave.Error) as exc:
        raise AudioAnalysisError(f"WAVを読み込めません: {exc}") from exc
