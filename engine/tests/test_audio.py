import math
import tempfile
import unittest
import wave
from pathlib import Path
from voicebankstudio_audio import analyze_wav
from voicebankstudio_audio import dsp


class AudioAnalysisTests(unittest.TestCase):
    def make_tone(self, path: Path, frequency=220.0, seconds=0.5, rate=16000):
        frames = bytearray()
        for index in range(int(seconds * rate)):
            sample = int(0.5 * 32767 * math.sin(2 * math.pi * frequency * index / rate))
            frames.extend(sample.to_bytes(2, "little", signed=True))
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(frames)

    def make_click_track(self, path: Path, bpm=120, seconds=10, rate=16000):
        frames = bytearray()
        interval = int(rate * 60 / bpm)
        click_length = int(rate * 0.015)
        for index in range(rate * seconds):
            if index % interval < click_length:
                sample = int(0.6 * 32767 * math.sin(2 * math.pi * 900 * (index % interval) / rate))
            else:
                sample = 0
            frames.extend(sample.to_bytes(2, "little", signed=True))
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(frames)

    def test_reads_wav_and_estimates_pitch(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "tone.wav"
            self.make_tone(path)
            result = analyze_wav(path)
            self.assertEqual(result["sample_rate"], 16000)
            self.assertAlmostEqual(result["duration_seconds"], 0.5, places=2)
            self.assertGreater(result["rms"], 0.2)
            self.assertAlmostEqual(result["pitch_hz"], 220.0, delta=8.0)
            self.assertGreaterEqual(result["pitch_frame_count"], 1)

    def test_peak_and_rms_cover_the_entire_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "changing_level.wav"
            frames = bytearray()
            rate = 16000
            for index in range(rate):
                amplitude = 0.1 if index < rate // 2 else 0.8
                sample = int(amplitude * 32767 * math.sin(2 * math.pi * 220 * index / rate))
                frames.extend(sample.to_bytes(2, "little", signed=True))
            with wave.open(str(path), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(rate)
                wav.writeframes(frames)

            result = analyze_wav(path)
            self.assertGreater(result["peak"], 0.75)
            self.assertGreater(result["rms"], 0.35)
            self.assertLess(result["rms"], 0.45)

    def test_estimates_click_track_tempo(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "click.wav"
            self.make_click_track(path)
            result = analyze_wav(path)
            self.assertAlmostEqual(result["tempo_bpm"], 120.0, delta=2.0)

    def test_peak_detects_transient_between_decimated_pitch_samples(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "transient.wav"
            rate = 44100
            frames = bytearray(rate // 4 * 2)
            # Put a single peak on an odd source frame; the former stride-2
            # metric sampling could skip it entirely.
            frames[1 * 2:1 * 2 + 2] = int(30000).to_bytes(2, "little", signed=True)
            with wave.open(str(path), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(rate)
                wav.writeframes(frames)
            result = analyze_wav(path)
            self.assertGreater(result["peak"], 0.9)

    def test_short_trailing_audio_is_included_in_analyzed_duration(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "trailing.wav"
            self.make_tone(path, seconds=0.53, rate=16000)
            result = analyze_wav(path)
            self.assertAlmostEqual(result["analyzed_seconds"], 0.53, delta=0.002)
            self.assertAlmostEqual(result["duration_seconds"], 0.53, delta=0.002)

    def test_python_fallback_matches_basic_tone_analysis(self):
        rate = 16000
        pcm = bytearray()
        for index in range(rate // 2):
            sample = int(0.5 * 32767 * math.sin(2 * math.pi * 220 * index / rate))
            pcm.extend(sample.to_bytes(2, "little", signed=True))

        native = dsp._native_analyze
        try:
            dsp._native_analyze = None
            result = dsp.analyze_pcm(bytes(pcm), rate, 1, 2)
        finally:
            dsp._native_analyze = native

        self.assertGreater(result["peak"], 0.49)
        self.assertAlmostEqual(result["pitch_hz"], 220.0, delta=8.0)

    def test_silence_does_not_produce_a_pitch(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "silence.wav"
            with wave.open(str(path), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(bytes(16000 * 2 // 2))
            result = analyze_wav(path)
            self.assertEqual(result["pitch_detected_frame_count"], 0)
            self.assertEqual(result["pitch_hz"], 0.0)

    def make_pcm_tone(self, frequency, seconds=0.5, rate=16000, amplitude=0.5):
        pcm = bytearray()
        for index in range(int(seconds * rate)):
            sample = int(amplitude * 32767 * math.sin(2 * math.pi * frequency * index / rate))
            pcm.extend(sample.to_bytes(2, "little", signed=True))
        return bytes(pcm)

    def test_pitch_accuracy_across_supported_frequency_range(self):
        # Exercise low, middle, and high notes rather than validating only A3.
        for frequency in (60.0, 80.0, 110.0, 220.0, 440.0, 880.0, 1000.0):
            with self.subTest(frequency=frequency):
                result = dsp.analyze_pcm(self.make_pcm_tone(frequency), 16000, 1, 2)
                self.assertGreater(result["pitch_confidence"], 0.55)
                self.assertAlmostEqual(result["pitch_hz"], frequency, delta=max(5.0, frequency * 0.025))

    def test_pitch_estimator_rejects_unvoiced_white_noise(self):
        # Deterministic pseudo-random noise represents a non-periodic breath/noise segment.
        state = 123456789
        pcm = bytearray()
        for _ in range(8000):
            state = (1103515245 * state + 12345) & 0x7fffffff
            sample = int(((state / 0x7fffffff) * 2.0 - 1.0) * 0.25 * 32767)
            pcm.extend(sample.to_bytes(2, "little", signed=True))
        result = dsp.analyze_pcm(bytes(pcm), 16000, 1, 2)
        self.assertEqual(result["pitch_hz"], 0.0)

    def test_python_fallback_pitch_accuracy_across_frequency_range(self):
        native = dsp._native_analyze
        try:
            dsp._native_analyze = None
            for frequency in (60.0, 110.0, 220.0, 440.0, 880.0, 1000.0):
                with self.subTest(frequency=frequency):
                    result = dsp.analyze_pcm(self.make_pcm_tone(frequency), 16000, 1, 2)
                    self.assertGreater(result["pitch_confidence"], 0.55)
                    self.assertAlmostEqual(result["pitch_hz"], frequency, delta=max(5.0, frequency * 0.025))
        finally:
            dsp._native_analyze = native

    def test_source_file_is_not_modified(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "tone.wav"
            self.make_tone(path)
            before = path.read_bytes()
            analyze_wav(path)
            self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
