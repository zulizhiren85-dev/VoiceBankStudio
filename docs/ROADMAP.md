# VoiceBankStudio — Development Roadmap

The implementation order is fixed by the project owner:

1. **Audio analysis**
2. **Voicebank sample import (原音読み込み)**
3. **Song creation**

Each stage must be tested before moving to the next. Existing SwiftUI source and the GitHub Pages prototype are preserved during this rebuild.

## Phase 1 — Audio analysis (current priority)

- Import local audio through the native iPad document picker without modifying the original.
- Copy selected source media into app-managed storage and preserve the original import.
- Play imported audio locally through AVFoundation.
- Analyze audio in bounded AVAudioFile buffers without uploading it or loading the entire recording into memory.
- Inspect format, duration, sample rate, channel count, and audio level.
- Build a time-based pitch estimate with note names and confidence values (initial native prototype uses approximately 0.5-second windows).
- Estimate BPM and rhythmic pulse from the audio envelope.
- Display all analysis as provisional, editable suggestions.
- Distinguish vocal, instrumental, and mixed audio where possible; do not claim reliable classification until validated.
- Later extend to chord estimation, beat positions, melody extraction, and source alignment/separation.
- Process long audio in bounded chunks; provide progress, cancellation, and recovery.
- Keep all core processing local and offline.

**Current implementation:** Python WAV PCM reader, optional native C DSP extension, pure-Python fallback, pitch-window timeline, rough BPM estimate, and automated tests. Native SwiftUI source now includes local file import, playback, bounded AVAudioFile reading, Peak/RMS, and provisional pitch-window display. The native Swift source has not yet been built or verified on a physical iPad. This is an early analysis foundation, not full song transcription. Chord analysis, accurate polyphonic melody extraction, vocal separation, robust BPM analysis in the native app, and a validated iPad release are not yet implemented.

**Completion goal:** A user can select a WAV, run local analysis, inspect approximate pitch and tempo results, and correct or reject them.

## Phase 2 — Voicebank sample import (原音読み込み)

- Import an existing UTAU voicebank folder or ZIP package.
- Parse and validate oto.ini.
- Read voicebank metadata and sample WAV files without changing them.
- Support VCV (連続音), CV, and relevant UTAU aliases.
- Support multiple pitch layers and voicebank variants, including the planned 7-pitch VCV Weak bank.
- Show missing samples, invalid aliases, and malformed oto.ini entries clearly.
- Preview a selected sample and allow safe, non-destructive correction of oto.ini parameters.
- Preserve the imported source folder; save corrections as project data or an exported copy.

**Completion goal:** A user can import a voicebank, inspect its samples and oto.ini settings, audition entries, and select it for a song project.

## Phase 3 — Song creation

- Create, open, rename, and save song projects.
- Import an instrumental, original mix, or vocal-only audio.
- Enter notes and lyrics with a simple workflow such as C4 / あ / 1 beat.
- Use analysis suggestions as a starting point, then allow manual editing of pitch, lyric/phoneme, duration, and timing.
- Provide main, secondary vocal, harmony, chorus, and instrumental tracks.
- Assign the same or different voicebanks to vocal tracks.
- Connect note/lyric data to a UTAU-compatible synthesis engine.
- Preview and render vocal tracks, mix them with the unchanged instrumental, and export audio.
- Add an optional piano-roll editor later as an advanced view.

**Completion goal:** A user can build an editable song, synthesize it with an imported voicebank, mix it with an instrumental, and export the result.

## Later phases

### Voicebank creation and recording

- Add guided voicebank recording.
- Split recordings into individual WAV samples.
- Analyze sample quality and pronunciation timing.
- Generate editable oto.ini suggestions.
- Support manual adjustment, audition, and UTAU-compatible voicebank export.

### Projects, backup, and sync

- Use stable project UUIDs and portable .voiceproj packages.
- Add autosave, recovery, and multiple versioned local backups.
- Add optional Google Drive synchronization with Wi-Fi-only transfers, pause/resume, retry, and non-destructive versioning.

## Development rules

- Do not remove the existing SwiftUI source or browser prototype while the new engine is being built.
- Preserve source audio and voicebank files; never overwrite imported originals.
- Keep network access optional, disabled on cellular, and inactive by default.
- Make automated analysis provisional and editable.
- Build and test one stage at a time. Do not begin the next stage until the current stage has a usable, tested foundation.
- Prioritize low memory use, short processing chunks, and understandable errors for iPad.
