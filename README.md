# VoiceBankStudio

An iPad-focused UTAU voicebank and singing-production app.

## Current development direction

VoiceBankStudio is now being developed as an **iPad-local-first application**. Audio import, playback, analysis, voicebank inspection, and eventually singing synthesis should work on the device without requiring a server. Cloud/server features remain optional support tools and must never be required for the basic workflow.

- **SwiftUI + AVFoundation:** native iPad interface, local media import, playback, and device-side audio processing.
- **Python + C:** portable reference/analysis engine and a foundation for algorithm validation. It is not assumed to run inside Safari.
- **Future UTAU engine:** investigate OpenUtau Core and its dependencies after the basic local app and audio pipeline are stable.
- **Browser prototype:** preserved for reference and lightweight testing; it is not the primary iPad runtime.

## Implemented native iPad source (not yet device-verified)

The SwiftUI source currently includes:
- Local audio file import through the iOS document picker.
- A private app Documents copy that preserves the original selected file.
- Local playback through AVAudioPlayer.
- Chunked AVAudioFile analysis without loading the complete source recording into memory.
- Peak and RMS measurement.
- A rough pitch estimate per approximately 0.5-second chunk, with note names and confidence values.
- A simple analysis result view.

**Important:** these Swift files have been added/updated, but an iPad build and on-device test have not yet been completed. Treat the pitch estimate as provisional; it is not melody transcription. Tempo estimation, multi-pitch/chord analysis, vocal separation, voicebank import, and UTAU synthesis are not yet part of this native screen.

## Existing Python/C engine

The `engine/` directory contains:
- WAV PCM inspection for 8/16/24/32-bit integer samples.
- Duration, sample rate, channel count, peak, and RMS measurement.
- Rough monophonic pitch estimates and a basic tempo estimate.
- A pure-Python fallback and an optional native C DSP extension.
- Automated tests and a GitHub Actions build/test workflow.

This engine is a tested reference foundation, not a finished iPad integration. The Python runtime and C extension still need a deliberate iOS packaging/build strategy if we choose to embed them later.

## Project principles

- Local-first: source audio, voicebanks, and projects stay on the device by default.
- No audio uploads by default.
- Network features are optional and Wi-Fi-only.
- Preserve original audio and voicebank files; edits are non-destructive.
- Process long media in bounded chunks and expose progress/cancellation.
- Keep processing bounded for iPad memory, battery, and thermal limits.
- Make automatic analysis provisional and editable.
- Build and test one stage at a time.

## Existing source

- `Sources/VoiceBankStudio/` — SwiftUI iPad app source.
- `engine/` — Python package and C audio-processing module.
- `docs/` — architecture and development roadmap.
- `index.html` — earlier GitHub Pages browser prototype.
- `engine-dotnet/` — experimental OpenUtau-based server engine, preserved separately while the local-first direction is developed.

## Development order

1. Complete and validate native local audio import, playback, and analysis.
2. Implement local voicebank ZIP/folder import and safe oto.ini/prefix.map inspection.
3. Build local song/project data and note/lyric editing.
4. Implement and validate local sample playback and UTAU-compatible synthesis.
5. Only after the basic application is stable, evaluate and integrate portable parts of OpenUtau Core.
6. Keep optional server functionality separate from the offline core.
