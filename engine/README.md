# VoiceBankStudio Audio Engine

This directory contains the first Python + native C implementation of the audio analysis engine.

## Current analysis behavior

- Reads uncompressed integer PCM WAV files (8/16/24/32-bit).
- Supports 1–8 channels and reports duration, sample rate, channel count, Peak, and whole-file RMS.
- Measures Peak and RMS over every decoded source frame. Pitch-analysis decimation does not affect level measurements.
- Estimates one rough pitch value per approximately 250 ms window, with confidence and note-name fields.
- Estimates a rough tempo from a 10 ms RMS envelope, currently searching approximately 60–200 BPM.
- Processes WAV data sequentially; the source recording is not modified.
- Uses native C for the analysis hot path when compiled and a pure-Python fallback otherwise.

## Known limitations

Pitch is currently a rough monophonic estimate based on normalized autocorrelation. It can make octave errors, miss breathy or unvoiced sounds, and cannot reliably follow fast vibrato, scoops, or transitions at the current window size. It is not melody transcription and does not separate vocals from accompaniment. Chords and polyphonic pitch tracking are not implemented.

Tempo is a lightweight estimate and can return half-time or double-time values, particularly on music without clear percussion. The current BPM search range does not include tempos below 60 or above 200 BPM.

UTAU-specific consonant/vowel boundary detection, oto.ini estimation, formant analysis, and synthesis are not implemented yet. These require separate validated analysis stages.

## Local development

From this directory, run:

    python -m pip install .
    python -m unittest discover -s tests -v

A C compiler is required to build the native extension. Without it, the Python fallback can be imported with PYTHONPATH=python.

## iPad direction

The current GitHub Pages prototype cannot execute this native C extension. The iPad app will need a packaged iOS runtime and a compiled iOS version of the C module. Existing SwiftUI files are being preserved while the Python/C engine is developed and tested separately.
