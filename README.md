# VoiceBankStudio

**VoiceBankStudio is an iPad-first, all-in-one UTAU music-production environment.**

## 根本目的 / Core purpose

The highest-priority goal is to let a user create a complete song on an iPad, from the first note to the finished audio, using UTAU voicebanks—without needing to switch to a separate desktop DAW for basic music production.

This purpose takes priority over individual features, implementation convenience, or short-term milestones. Every feature should contribute to a connected end-to-end music-making workflow.

The product has three integrated pillars:

1. **曲作成 (Song creation):** editable piano roll, melody and lyrics, UTAU singing, accompaniment and multiple tracks, mixer, project save/reopen, and WAV export.
2. **音声解析 (Audio analysis):** analyze audio, pitch, melody, rhythm, timing, pronunciation, and quality; provide useful, editable findings that support creation and improvement.
3. **音源制作 (Voicebank creation):** recording/import, oto.ini and alias configuration, sample analysis, voicebank construction, and export.

These are not separate apps. They must work together as one production environment: analyzed material should help create songs and voicebanks, and created voicebanks should be usable directly in the song editor.

## UTAU compatibility goal

The long-term singing-engine goal is broad compatibility with UTAU voicebank types and OpenUtau-supported phonemizer behavior—not VCV-only support. This includes CV, VCV, CVVC and relevant variants, multi-pitch banks, oto.ini, prefix.map, phoneme timing, consonant velocity, preutterance, overlap, and pitch/control data where supported by the upstream engine.

Use OpenUtau Core and its existing phonemizers/rendering behavior as the primary implementation reference and porting foundation. Preserve upstream behavior wherever practical; replace only platform-specific boundaries needed for iPad Safari/browser execution. Do not claim a voicebank type is supported until it has passed real browser-side tests.

## Current development direction

The current active work is the **song-creation pillar**, with an iPad Safari/browser implementation and an OpenUtau-based singing engine port. A Worldline WebAssembly proof of concept has successfully run F0 analysis and WORLD analysis/synthesis in the browser test path. This is a DSP milestone only; it does not yet prove complete local UTAU voicebank singing in Safari.

The existing server-side OpenUtau engine remains a fallback and a behavioral reference while local browser rendering is developed. Keep the fallback working.

## Development principles

- iPad-first and beginner-friendly, with advanced controls available when needed.
- Local-first processing where practical; make device-side singing a core goal.
- Preserve original voicebank files and project data; edits and analysis findings should be reversible.
- Prefer upstream OpenUtau compatibility over ad hoc simplified implementations.
- Validate each meaningful feature with automated tests and real voicebank/browser tests.
- Do not mark a feature complete based only on a successful synthetic fixture or DSP-only test.
- Keep the three pillars integrated and always prioritize the complete-song-making purpose.

## Repository areas

- `index.html` and browser assets — Safari/browser application.
- `voicebank.js` — voicebank import, metadata and browser-side voicebank handling.
- `engine-dotnet/` — headless OpenUtau-based singing engine and service.
- `assets/worldline/` and `scripts/` — Worldline WASM proof-of-concept assets and tests.
- `docs/` — architecture, feasibility notes and development plans.
- `Sources/` and `engine/` — earlier native/Python/C foundations retained for reference and future integration.

## Immediate milestone

Finish and validate the song-creation workflow first: verify real voicebank singing, improve stability and quality, then complete the editor, tracks, mixing, project persistence and export. After that, advance the analysis and voicebank-creation pillars while keeping all three connected to the core purpose above.
