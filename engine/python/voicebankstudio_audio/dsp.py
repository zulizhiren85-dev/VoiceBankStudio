"""Portable fallback for the native C DSP module."""
import math

try:
    from ._dsp import analyze_pcm as _native_analyze
except ImportError:
    _native_analyze = None


def analyze_pcm(data: bytes, sample_rate: int, channels: int, sample_width: int) -> dict:
    if _native_analyze is not None:
        return _native_analyze(data, sample_rate, channels, sample_width)
    frame_bytes = channels * sample_width
    frame_count = len(data) // frame_bytes
    if frame_count < 2:
        raise ValueError("音声データが短すぎます")
    stride = max(1, math.ceil(frame_count / 8192))
    samples = []
    for frame in range(0, frame_count, stride):
        offset = frame * frame_bytes
        total = 0.0
        for channel in range(channels):
            start = offset + channel * sample_width
            raw = data[start:start + sample_width]
            if sample_width == 1:
                value = (raw[0] - 128) / 128.0
            else:
                value = int.from_bytes(raw, "little", signed=True) / float(1 << (8 * sample_width - 1))
            total += value
        samples.append(total / channels)
    rate = sample_rate / stride
    peak = max(abs(x) for x in samples)
    rms = math.sqrt(sum(x * x for x in samples) / len(samples))
    crossings = sum(1 for a, b in zip(samples, samples[1:]) if (a < 0 <= b) or (a >= 0 > b))
    best_corr, best_lag = 0.0, 0
    min_lag = max(1, int(rate / 1000))
    max_lag = min(len(samples) // 2, int(rate / 60))
    if rms > 0.002:
        for lag in range(min_lag, max_lag + 1):
            left, right = samples[:-lag], samples[lag:]
            cross = sum(a * b for a, b in zip(left, right))
            norm_a = sum(a * a for a in left)
            norm_b = sum(b * b for b in right)
            denom = math.sqrt(norm_a * norm_b)
            corr = cross / denom if denom else 0.0
            if corr > best_corr:
                best_corr, best_lag = corr, lag
    return {
        "peak": peak, "rms": rms,
        "zero_crossings_per_second": crossings * rate / len(samples),
        "pitch_hz": rate / best_lag if best_lag and best_corr > 0.55 else 0.0,
        "pitch_confidence": best_corr, "analyzed_samples": len(samples),
    }
