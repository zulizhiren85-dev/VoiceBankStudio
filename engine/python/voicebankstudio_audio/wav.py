"""Streaming WAV inspection and first-pass local music analysis."""
import math
import wave
from pathlib import Path

from .dsp import analyze_pcm


class AudioAnalysisError(Exception):
    """Readable error raised when an audio file cannot be analyzed."""


def _rms_pcm(data: bytes, channels: int, width: int) -> float:
    frame_bytes = channels * width
    frames = len(data) // frame_bytes
    if frames == 0:
        return 0.0
    total = 0.0
    count = 0
    for frame in range(frames):
        base = frame * frame_bytes
        mixed = 0.0
        for channel in range(channels):
            start = base + channel * width
            raw = data[start:start + width]
            if width == 1:
                value = (raw[0] - 128) / 128.0
            else:
                value = int.from_bytes(raw, "little", signed=True) / float(1 << (8 * width - 1))
            mixed += value
        mixed /= channels
        total += mixed * mixed
        count += 1
    return math.sqrt(total / count)


def _estimate_tempo(envelope: list[float], hop_seconds: float) -> tuple[float, float]:
    if len(envelope) < 300:
        return 0.0, 0.0
    onset = [max(0.0, b - a) for a, b in zip(envelope, envelope[1:])]
    mean = sum(onset) / len(onset)
    onset = [x - mean for x in onset]
    energy = sum(x * x for x in onset)
    if energy < 1e-8:
        return 0.0, 0.0
    min_lag = max(1, int(60.0 / (200.0 * hop_seconds)))
    max_lag = min(len(onset) // 2, int(60.0 / (60.0 * hop_seconds)))
    best_lag, best_score = 0, 0.0
    for lag in range(min_lag, max_lag + 1):
        score = sum(onset[i] * onset[i + lag] for i in range(len(onset) - lag))
        if score > best_score:
            best_lag, best_score = lag, score
    if not best_lag:
        return 0.0, 0.0
    confidence = max(0.0, min(1.0, best_score / energy))
    bpm = 60.0 / (best_lag * hop_seconds)
    return round(bpm, 1), round(confidence, 3)


def _pitch_name(frequency: float) -> str | None:
    if frequency <= 0:
        return None
    midi = int(round(69 + 12 * math.log2(frequency / 440.0)))
    names = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    return f"{names[midi % 12]}{midi // 12 - 1}"


def analyze_wav(path: str | Path, pitch_window_seconds: float = 0.25) -> dict:
    """Analyze an uncompressed PCM WAV without changing or loading the whole source."""
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

            duration = frames_total / rate
            pitch_frames = []
            window_frames = max(256, int(rate * pitch_window_seconds))
            # Sequential windows keep peak memory bounded even for long recordings.
            while True:
                raw = wav.readframes(window_frames)
                if not raw:
                    break
                frame_count = len(raw) // (channels * width)
                if frame_count < int(rate * 0.08):
                    break
                metrics = analyze_pcm(raw, rate, channels, width)
                hz = metrics["pitch_hz"]
                pitch_frames.append({
                    "time_seconds": round((len(pitch_frames) * window_frames) / rate, 3),
                    "frequency_hz": round(hz, 2) if hz else None,
                    "note": _pitch_name(hz),
                    "confidence": round(metrics["pitch_confidence"], 3),
                    "rms": round(metrics["rms"], 5),
                })

            # Re-open for a lightweight 10 ms energy envelope used for rough tempo estimation.
        with wave.open(str(source), "rb") as wav:
            hop_frames = max(1, int(rate * 0.01))
            envelope = []
            while True:
                raw = wav.readframes(hop_frames)
                if not raw:
                    break
                envelope.append(_rms_pcm(raw, channels, width))
        tempo, tempo_confidence = _estimate_tempo(envelope, hop_frames / rate)

        first = pitch_frames[0] if pitch_frames else {}
        valid_pitches = [x["frequency_hz"] for x in pitch_frames if x["frequency_hz"]]
        return {
            "file_name": source.name,
            "format": "WAV PCM",
            "duration_seconds": round(duration, 3),
            "sample_rate": rate,
            "channels": channels,
            "sample_width_bytes": width,
            "peak": None,
            "rms": first.get("rms", 0.0),
            "pitch_hz": first.get("frequency_hz", 0.0) or 0.0,
            "pitch_frames": pitch_frames,
            "pitch_frame_count": len(pitch_frames),
            "pitch_detected_frame_count": len(valid_pitches),
            "tempo_bpm": tempo,
            "tempo_confidence": tempo_confidence,
            "analyzed_seconds": round(min(duration, len(pitch_frames) * window_frames / rate), 3),
            "analysis_note": "音程とBPMは簡易推定です。特に伴奏のみ・和音を含む音源では誤判定することがあります。",
        }
    except AudioAnalysisError:
        raise
    except (OSError, EOFError, wave.Error) as exc:
        raise AudioAnalysisError(f"WAVを読み込めません: {exc}") from exc
