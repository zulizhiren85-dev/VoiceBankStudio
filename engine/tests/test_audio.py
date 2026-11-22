import math
import tempfile
import unittest
import wave
from pathlib import Path
from voicebankstudio_audio import analyze_wav


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

    def test_source_file_is_not_modified(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "tone.wav"
            self.make_tone(path)
            before = path.read_bytes()
            analyze_wav(path)
            self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
