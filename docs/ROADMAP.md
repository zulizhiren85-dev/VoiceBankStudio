# VoiceBankStudio — Development Roadmap

The first development priority is **Song Studio and Audio Analysis**. Voicebank recording and creation will follow after the song workflow has a usable foundation.

This roadmap describes the intended order. It does not mean the features are already implemented.

## Phase 1 — Song project foundation

- Create, open, rename, and save song projects.
- Import an original song, an instrumental, or vocal-only audio.
- Preserve imported source files unchanged.
- Display audio duration and basic playback controls.
- Add autosave and recovery for song project data.
- Keep all network-dependent features disabled on cellular data; core local work must function offline.

**Completion goal:** A user can create a song project, import audio, listen to it, save it, close it, and reopen it without losing the source files or project state.

## Phase 2 — Audio analysis

- Analyze audio duration, waveform, approximate tempo, and beat positions.
- Estimate pitch and note timing from vocal audio.
- Estimate lyric/phoneme timing where feasible and allow manual correction.
- Identify possible main vocal, harmony, and chorus parts, while treating classification as a suggestion.
- Present all automatic results as provisional and editable.
- Provide clear confidence or warning information when an estimate may be unreliable.

**Completion goal:** A user can import vocal audio, run local analysis, inspect the proposed notes and timing, and correct mistakes manually.

## Phase 3 — Original and instrumental alignment

- Support importing an original mix and its corresponding instrumental.
- Estimate and adjust start-time offset.
- Offer phase-inversion subtraction only when the audio sources are sufficiently matched in timing, gain, phase, and content.
- Detect or warn about mismatch and time drift where possible.
- Offer optional source separation as a fallback path when subtraction is unsuitable.
- Never replace or destructively modify the imported instrumental.

**Completion goal:** A user can align a suitable original/instrumental pair, preview the result, and choose a suitable vocal-extraction method without losing either source.

## Phase 4 — Editable song arrangement

- Provide a beginner-friendly note and lyric entry workflow, for example `C4 / あ / 1 beat`.
- Allow edits to pitch, lyric/phoneme, duration, and timing.
- Provide a simple track view for main vocal, secondary vocal, harmony, chorus, and instrumental.
- Allow automatic track-role suggestions to be corrected manually.
- Support a piano-roll-style editor later as an optional advanced view.

**Completion goal:** A user can build and edit a song's vocal arrangement without needing to operate a complex piano roll.

## Phase 5 — Voicebank assignment and vocal synthesis

- Assign one voicebank to all vocal tracks or different voicebanks to main and secondary tracks.
- Allow reassignment later with confirmation.
- Connect the editable note/lyric data to a UTAU-compatible synthesis engine.
- Preview and render vocal tracks independently.

**Completion goal:** A user can synthesize editable vocal tracks from the song arrangement using selected voicebanks.

## Phase 6 — Mixing and export

- Mix synthesized vocals with the unchanged instrumental.
- Provide basic volume, pan, and track mute/solo controls.
- Preview the complete result.
- Export the finished audio and save the editable project.

**Completion goal:** A user can export a finished cover or original song project.

## Phase 7 — Voicebank creation

- Add guided voicebank recording.
- Split recordings into individual WAV samples.
- Analyze sample quality and pronunciation timing.
- Generate editable oto.ini suggestions.
- Support manual adjustment, audition, and UTAU-compatible voicebank export.

**Completion goal:** A user can create and export a voicebank from guided recordings.

## Phase 8 — Backup, sync, and refinement

- Add versioned local backups and safe restore.
- Add optional Google Drive synchronization with Wi-Fi-only transfers, pause/resume, and retry.
- Improve performance, accessibility, error recovery, and beginner guidance.
- Validate behavior on the target iPadOS versions and devices.

## Development rule

Build and test one small, usable step at a time. Prioritize reliable local saving and preservation of original audio before adding complex analysis, cloud features, or synthesis. Keep expensive or network-dependent processing optional and transparent.
