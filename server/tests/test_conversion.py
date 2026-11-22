"""Regression tests for the upload conversion path."""
import math
import os
import struct
import tempfile
import unittest
import wave

from server.main import OUTPUT_RATE, convert_to_analysis_wav
from voicebankstudio_audio import analyze_wav


class AudioConversionTests(unittest.TestCase):
    def make_test_wav(self, path: str) -> None:
        rate = 44100
        seconds = 0.6
        with wave.open(path, "wb") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(rate)
            frames = bytearray()
            for i in range(int(rate * seconds)):
                sample = int(9000 * math.sin(2 * math.pi * 440 * i / rate))
                frames.extend(struct.pack("<hh", sample, sample))
            output.writeframes(frames)

    def test_stereo_wav_converts_to_mono_pcm_and_is_analyzable(self):
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, "source.wav")
            converted = os.path.join(folder, "converted.wav")
            self.make_test_wav(source)

            duration = convert_to_analysis_wav(source, converted)

            self.assertAlmostEqual(duration, 0.6, delta=0.02)
            with wave.open(converted, "rb") as wav:
                self.assertEqual(wav.getnchannels(), 1)
                self.assertEqual(wav.getsampwidth(), 2)
                self.assertEqual(wav.getframerate(), OUTPUT_RATE)
            result = analyze_wav(converted)
            self.assertGreater(result["pitch_frame_count"], 0)
            self.assertAlmostEqual(result["duration_seconds"], 0.6, delta=0.03)

    def test_invalid_audio_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, "broken.mp3")
            converted = os.path.join(folder, "converted.wav")
            with open(source, "wb") as stream:
                stream.write(b"this is not an audio file")
            with self.assertRaises(ValueError):
                convert_to_analysis_wav(source, converted)


if __name__ == "__main__":
    unittest.main()
