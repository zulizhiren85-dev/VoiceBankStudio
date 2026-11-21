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

    def test_reads_wav_and_estimates_pitch(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "tone.wav"
            self.make_tone(path)
            result = analyze_wav(path)
            self.assertEqual(result["sample_rate"], 16000)
            self.assertAlmostEqual(result["duration_seconds"], 0.5, places=2)
            self.assertGreater(result["peak"], 0.4)
            self.assertAlmostEqual(result["pitch_hz"], 220.0, delta=8.0)

    def test_source_file_is_not_modified(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "tone.wav"
            self.make_tone(path)
            before = path.read_bytes()
            analyze_wav(path)
            self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
