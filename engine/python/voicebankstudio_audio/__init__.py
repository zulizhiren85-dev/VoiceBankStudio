"""VoiceBankStudio local audio analysis package."""
from .wav import analyze_wav, AudioAnalysisError

__all__ = ["analyze_wav", "AudioAnalysisError"]
