# Pitch-aware voicebank sample selection

## Product behavior

The piano-roll note is the source of truth. VoiceBankStudio must not add a global octave offset or silently transpose the user's score. The singing engine should choose the most suitable recorded sample for the requested note and transform that sample to the requested pitch.

## OpenUtau path already available

The pinned OpenUtau Core revision provides the required foundation:

1. `ClassicSinger.TryGetMappedOto(phoneme, tone)` selects the mapped oto for the requested MIDI tone. This applies the voicebank's subbank ranges and `prefix.map`, then falls back to the unprefixed alias when no mapped alias exists.
2. The Japanese phonemizers request aliases in the context of each note, so note tone participates in source selection.
3. VoiceBankStudio renders through OpenUtau's `WORLDLINE_R` renderer. Its Worldline resampler transforms the selected source sample to the requested note pitch and duration.

This is preferable to applying an independent post-render pitch shifter because it keeps sample selection, oto timing, and synthesis inside the upstream UTAU-compatible engine.

## VoiceBankStudio rules

- Convert the written note name to its MIDI tone without octave offsets.
- Keep the note's target tone unchanged in the request sent to OpenUtau.
- Let OpenUtau select a pitch subbank and source oto for each phoneme.
- Let Worldline-R perform the source-to-target pitch/duration conversion.
- Never rewrite the score to another octave automatically.
- If a suitable mapped source is unavailable, preserve OpenUtau's normal fallback behavior and report the limitation rather than silently transposing the note.

## Validation

- Browser E2E verifies that D4 is sent as MIDI 62, with no octave offset.
- The OpenUtau engine inspection endpoint reports the selected alias and source WAV for each semitone from MIDI 36 through 96.
- CI verifies that the synthetic `prefix.map` selects the low subbank at C4 and B4 and the high subbank at C5 and C6, and that Worldline-R still produces a non-silent WAV.
- Real-bank acceptance is still required on iPad Safari. In particular, test the user's 7-pitch VCV bank and listen for pitch accuracy, timbre changes at subbank boundaries, and artifacts at large transposition distances.

## Not yet claimed

The current server engine uses OpenUtau's pitch-aware source selection and Worldline-R resampling. This does not yet prove that every voicebank has correct pitch coverage, that all UTAU resamplers behave identically, or that the full singing engine runs locally in Safari. Do not label the full automatic pitch-matching feature complete until real-bank tests pass.
