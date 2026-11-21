# VoiceBankStudio

An iPad-focused UTAU voicebank and singing-production app.

## Development direction

The project is moving toward a Python-first application core with a native C audio-processing module. The existing SwiftUI source and GitHub Pages prototype are being preserved while the new engine is built and validated.

- **Python:** application logic, project data, WAV handling, and analysis orchestration.
- **C:** performance-sensitive PCM processing and signal analysis.
- **iPad integration:** package the Python runtime and compile the C module for iOS after the engine has a reliable test foundation.

The GitHub Pages version is a browser prototype. It does not execute the native Python/C engine.

## Current Python/C engine milestone

The engine/ directory currently contains:

- WAV PCM inspection for 8/16/24/32-bit integer samples.
- Duration, sample rate, channel count, peak, and RMS measurement.
- A rough single-pitch estimate from up to the first second.
- A pure-Python fallback when the C extension is not compiled.
- Automated tests and a GitHub Actions build/test workflow.

This is an early engine foundation, not yet a finished iPad app. The pitch estimate is not melody transcription; chord analysis, vocal separation, UTAU synthesis, and the iPad interface integration remain future work.

## Project principles

- Local-first: source audio and projects stay on the device.
- No audio uploads by default.
- Network features are optional and Wi-Fi-only.
- Preserve original audio; analysis is provisional and editable.
- Keep processing bounded and suitable for iPad memory and battery limits.
- Beginner-friendly controls first, advanced controls later.

## Existing source

- Sources/VoiceBankStudio/ — existing SwiftUI app source, preserved for later iPad integration.
- engine/ — Python package and C audio-processing module.
- docs/ — architecture and development roadmap.
- index.html — earlier GitHub Pages browser prototype.

## Next milestones

1. Validate the Python/C WAV engine in CI.
2. Add reliable file import and project metadata.
3. Expand pitch and tempo analysis in short, resumable chunks.
4. Design the iPad runtime integration.
5. Continue with editable notes/lyrics, voicebank assignment, synthesis, and mixing.
