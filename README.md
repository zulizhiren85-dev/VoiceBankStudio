# VoiceBankStudio

An iPad-focused tool for creating UTAU-compatible voicebanks and producing singing vocals.

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

## Planned structure

- `docs/` — architecture, workflow, and development notes
- `Sources/VoiceBankStudio/` — application source code
- `Tests/` — automated tests
- `Resources/` — app resources

## Status

Early planning and repository setup. Features are not implemented yet.
