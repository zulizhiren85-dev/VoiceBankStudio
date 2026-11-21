# VoiceBankStudio

An iPad-focused tool for creating UTAU-compatible voicebanks and producing singing vocals.

## Current development focus

The first implementation milestone is Song Studio: importing audio, preserving a local copy, and basic playback. Audio analysis and editing will be added in later steps.

## Project goals

- Guide beginners through voicebank recording, review, and correction.
- Preserve original recordings and generate editable oto.ini settings.
- Import songs and instrumentals, analyze vocals, and create editable note and lyric data.
- Assign voicebanks to vocal tracks, synthesize vocals, and mix them with the backing track.
- Export UTAU-compatible voicebanks and finished audio.

## Design principles

- Local-first: projects and recordings remain on the device.
- Network features use Wi-Fi only and remain optional.
- Automatic analysis is provisional and can be corrected by the user.
- Keep raw audio safe even when analysis or export fails.
- Prefer a simple beginner workflow, with advanced controls available when needed.

## Source layout

- `docs/` — architecture and development roadmap
- `Sources/VoiceBankStudio/App/` — application entry point
- `Sources/VoiceBankStudio/SongStudio/` — song creation and playback interface

## Current status

- [x] Initial SwiftUI app entry point
- [x] First Song Studio screen
- [x] Import and copy one audio file into the app's Documents folder
- [x] Basic play, pause, and stop controls
- [ ] Song project metadata and autosave
- [ ] Waveform and audio analysis
- [ ] Editable notes, lyrics, and tracks

The initial source files have not yet been compiled or tested in Xcode on an iPad.
