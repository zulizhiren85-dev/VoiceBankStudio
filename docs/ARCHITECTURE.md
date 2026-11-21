# VoiceBankStudio — Architecture Plan

## 1. Purpose

VoiceBankStudio is an iPad-focused application for creating UTAU-compatible voicebanks and producing singing vocals. The default experience should be approachable for beginners, while advanced controls remain available when needed.

This document describes the planned structure and behavior. It is a design plan, not a statement that these features have already been implemented.

## 2. Core design principles

- **Local-first:** projects, recordings, and working data are stored on the iPad.
- **Wi-Fi only:** every network-dependent feature must remain inactive on cellular data. Network work pauses when Wi-Fi is unavailable and can resume when Wi-Fi returns.
- **Optional cloud features:** cloud analysis and backup are optional. Explain what will be uploaded before sending user data.
- **Preserve source audio:** keep original recordings and imported audio unchanged. Failed analysis must never destroy the source.
- **Editable automation:** automatic detection and generated settings are provisional. Users can inspect and correct them.
- **Beginner-friendly workflow:** use clear labels, guided steps, large touch targets, progress indicators, undo/redo, and understandable error messages.
- **Resilient processing:** save checkpoints, support pause/resume where practical, and prioritize recording and saving over background work.

## 3. Main application areas

1. **Voicebank Studio** — create and manage characters, voicebanks, recordings, oto.ini settings, and exports.
2. **Song Studio** — import audio, edit notes and lyrics, assign voicebanks, synthesize vocals, and mix tracks.
3. **Audio Analysis** — inspect pitch, timing, phonemes, tempo, alignment, and track structure.
4. **Projects** — browse, rename, duplicate, and restore projects.
5. **Backup & Sync** — manage local snapshots and optional Google Drive synchronization.
6. **Settings** — audio input/output, recording behavior, processing limits, network policy, and beginner/advanced display mode.

## 4. Project and file model

- Each project has a stable internal UUID. Display names and folder names may be changed without changing that UUID.
- Character name is used as the character project/folder name. Voicebank name is a separate value; one character may own multiple voicebanks.
- Keep song projects and voicebank projects organized by character and project type.
- Store raw recordings separately from processed clips and generated analysis.
- Use a documented project format and provide a portable `.voiceproj` package export.
- Autosave working state separately from versioned backups.

A planned project layout is:

```text
VoiceBankStudio/
  Characters/
    <CharacterName>/
      character.json
      Voicebanks/
        <VoicebankName>/
          raw/
          samples/
          oto.ini
          voicebank.json
  Songs/
    <SongProjectName>/
      project.json
      Imports/
      Analysis/
      Tracks/
      Mixes/
  Backups/
  Settings/
```

The exact on-disk layout may change during implementation. File references should use stable IDs or managed relative paths rather than relying on display names alone.

## 5. Voicebank recording workflow

1. Create or select a character and voicebank.
2. Select a recording list. The initial planned workflow uses the 23-entry "まいこ製 最軽量リスト（切り出し単独音）".
3. Start guided recording with adjustable guide speed and spacing. The initial default proposal is BPM 100 and D4.
4. Show the current target prominently and preview upcoming targets.
5. Record continuously, then split the recording into individual WAV samples.
6. Allow playback and re-recording of each item. Preserve the original take and temporary recovery data.
7. Analyze level, clipping, silence, noise, duration, and pronunciation timing.
8. Generate suggested oto.ini values from the actual recording and analysis. Do not blindly copy template values.
9. Let the user audition, edit, and restore individual oto.ini parameters.
10. Export an UTAU-compatible voicebank.

Quality checks should compare individual phoneme timing and duration, not only the total recording duration. A proposed tolerance policy is: up to 10% passes, 10–15% warns, and above 15% blocks formal export until corrected. This threshold is a proposal and must remain configurable until validated.

If analysis fails, retain the raw WAV and report the failure. Do not discard a recording merely because automatic analysis could not complete.

## 6. Song creation and audio workflow

Support these starting points:

- Original song plus instrumental: attempt vocal extraction when appropriate, then analyze and edit the vocal parts.
- Instrumental only: analyze tempo and musical structure, then let the user enter notes and lyrics.
- Vocal-only audio: estimate pitch, note timing, lyrics/phonemes, and possible main, harmony, or chorus parts. Vocal-only tempo estimates should be treated cautiously.

For an original mix and its matching instrumental, phase-inversion subtraction may be attempted only when timing, gain, phase, and source alignment are sufficiently matched. Automatically estimate start offset and allow fine adjustment. If the sources do not match or drift over time, use source separation as an optional fallback rather than claiming subtraction will work reliably.

Analysis results are provisional and editable. Keep the instrumental track unchanged in the final mix unless the user explicitly edits it.

### Planned song pipeline

1. Import source audio and/or instrumental.
2. Inspect format and duration; preserve imported originals.
3. Align sources or run optional source separation.
4. Estimate pitch, timing, lyrics/phonemes, tempo, and track roles.
5. Present editable provisional note and lyric data.
6. Assign voicebanks to main and secondary/harmony tracks. Allow later reassignment with confirmation.
7. Synthesize vocal tracks.
8. Mix synthesized vocals with the unchanged backing track.
9. Preview and export the result.

The main editing method should be a simple event/grid workflow such as `C4 / あ / 1 beat`. A piano-roll view may be offered as an optional advanced editor.

## 7. Voicebank assignment

At the beginning of synthesis, offer two simple choices:

- Use the same voicebank for main and secondary vocal tracks.
- Assign different voicebanks to main and secondary vocal tracks.

Users may change assignments later. Before applying a change that affects multiple tracks, show what will be reassigned and ask for confirmation.

## 8. Audio engine and processing

- Keep recording, playback, analysis, synthesis, and mixing responsibilities separate.
- Use non-destructive processing: edits should refer to source media and processing parameters wherever practical.
- Process long audio in manageable chunks and save checkpoints.
- Limit memory use and reduce background processing when the iPad is hot or battery is low.
- Pause or throttle nonessential work when recording or saving needs resources.
- Make processing progress, cancellation, and recoverable errors visible.

The exact audio frameworks and synthesis engine are implementation decisions to be validated on the target iPadOS version.

## 9. Storage, autosave, and backup

- Save local project state automatically.
- Save raw recordings immediately and preserve them independently of analysis results.
- Keep autosave distinct from versioned snapshots.
- Maintain multiple backup generations and allow restoration of an earlier snapshot.
- Before restoring, create a safety backup of the current state.
- Restore in a staged manner with integrity checks and rollback on failure.
- Never delete an older valid backup just because a newer backup failed.

### Optional Google Drive sync

- Use a dedicated VoiceBankStudio backup folder.
- Mirror the project folder structure where practical.
- Prefer incremental synchronization of changed files.
- Use a queue with pause, resume, retry, and clear error reporting.
- Operate only on Wi-Fi; never use cellular data.
- Avoid destructive overwrites and deletions. Keep versioned copies where possible.
- Cloud backup must not be the only copy of a project.

## 10. Network policy

All network-dependent functions follow one shared policy:

- Do not start network transfers on cellular data.
- Pause pending network jobs when Wi-Fi is unavailable.
- Resume queued jobs when Wi-Fi returns, subject to user settings.
- Provide a manual network pause control.
- Make cloud AI optional and explain the data transfer before upload.
- Account for very slow connections with small chunks, retry/backoff, and resumable transfers where supported.

Offline recording, editing, and local processing should continue wherever possible.

## 11. User experience and accessibility

- Default to a simple mode; expose advanced controls separately.
- Use large, touch-friendly controls suitable for iPad.
- Explain specialist terms such as preutterance, overlap, offset, and consonant/vowel boundary.
- Provide undo/redo for edits.
- Show progress and allow cancellation for long operations.
- Use clear recovery guidance rather than generic error messages.
- Keep the most important recording and save actions responsive.

## 12. Planned source organization

```text
docs/
  ARCHITECTURE.md
  ROADMAP.md
Sources/
  VoiceBankStudio/
    App/
    Models/
    Storage/
    Audio/
    Recording/
    Voicebank/
    Analysis/
    SongEditor/
    Synthesis/
    Mixing/
    Backup/
    Network/
    UI/
Tests/
Resources/
```

This is a proposed logical organization. The implementation may adjust it as the project grows.

## 13. Open implementation questions

- Confirm the minimum supported iPadOS version and target devices.
- Validate the available recording, audio analysis, and synthesis frameworks.
- Select or implement a UTAU-compatible synthesis path and verify format compatibility.
- Decide which analysis features can run locally and which, if any, may use optional cloud services.
- Validate the proposed recording tolerance thresholds with real voicebank samples.
- Define the portable `.voiceproj` package format and migration strategy.
- Implement and test Google Drive authorization and resumable Wi-Fi-only synchronization.

## 14. Current status

This file is an architecture plan only. The application, audio engine, storage system, and synchronization features have not yet been implemented or validated.
