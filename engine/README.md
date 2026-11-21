# VoiceBankStudio Audio Engine

This directory contains the first Python + C implementation of the local audio engine.

## Current milestone

- Read uncompressed PCM WAV files (8/16/24/32-bit integer PCM).
- Inspect duration, sample rate, channel count, peak, and RMS.
- Estimate one rough pitch value from at most the first second.
- Use native C for the analysis hot path when compiled.
- Fall back to pure Python when the C extension is unavailable.
- Never modify the imported source file.

The pitch result is a rough single-frequency estimate, not melody transcription. Chords, polyphonic pitch tracking, vocal separation, and UTAU synthesis are not implemented yet.

## Local development

From this directory, run:

    python -m pip install .
    python -m unittest discover -s tests -v

A C compiler is required to build the native extension. Without it, the Python fallback can be imported with PYTHONPATH=python.

## iPad direction

The current GitHub Pages prototype cannot execute this native C extension. The iPad app will need a packaged iOS runtime and a compiled iOS version of the C module. The existing SwiftUI files are being preserved while the Python/C engine is developed and tested separately. No audio is uploaded by this engine.
