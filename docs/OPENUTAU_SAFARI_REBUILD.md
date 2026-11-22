# VoiceBankStudio — OpenUtau-based Safari Rebuild

## Goal

Build an iPad Safari singing editor that reuses OpenUtau's proven data model, voicebank handling, phonemizers, and rendering pipeline where technically and legally practical. This is not an attempt to run the OpenUtau desktop application inside Safari.

The guiding principle is:

```
Safari editor (JavaScript)
        |
   versioned API
        |
.NET service using reusable OpenUtau Core components
        |
       WAV
```

Keep the existing `main` branch and audio-analysis engine intact while the replacement is developed on a separate branch.

## Architecture decisions

### 1. Safari client — JavaScript / HTML / CSS

The browser owns the editing experience:

- Touch-friendly piano roll, timeline, track controls, lyric and note editing.
- Project save/load, undo/redo, tempo, and voicebank selection.
- Waveform display and playback using Web Audio API.
- JSON-based communication with the backend.
- Render-job status, progress, cancellation, and result playback.

The editor UI will be implemented for Safari rather than porting OpenUtau's Avalonia desktop UI. React, Canvas, WebGL, and Tone.js are candidates, not mandatory dependencies; choose them only where they solve a concrete need. Start with the smallest reliable JavaScript stack.

### 2. .NET singing service — reuse OpenUtau Core

Keep the desktop UI and desktop-only layers out of the server design. Investigate and isolate the smallest reusable Core components behind a service boundary.

Priority components to evaluate:

- USTX project and note/track data model.
- Voicebank/singer loading and oto.ini parsing.
- Existing Japanese CV, VCV, CVVC, and other applicable phonemizers.
- Resampler, wavtool, and phrase-rendering interfaces.

Expose narrow APIs for project validation/conversion, singer and voicebank information, phonemizer results, render-job creation/status/cancellation, and WAV retrieval.

Do not rewrite OpenUtau phonemizers in Python or JavaScript unless a specific compatibility gap makes it unavoidable. Do not assume the entire Core can be hosted unchanged: isolate dependencies and verify runtime compatibility first.

### 3. Python FastAPI — orchestration and audio analysis

Keep Python responsible for the existing audio-analysis service and suitable API/orchestration tasks:

- Upload validation and metadata inspection.
- Audio analysis and conversion workflows.
- Job coordination if it can be done cleanly without duplicating the .NET renderer.
- Stable API boundary between Safari and backend services.

The .NET singing service should own OpenUtau-dependent singer, phonemizer, and rendering behavior. Avoid making FastAPI a second implementation of the singing engine.

### 4. Rendering strategy

For the first working version, prefer server-side rendering through the reusable OpenUtau-compatible .NET pipeline. Safari submits a render job and later retrieves the WAV; it should not attempt to render a full song on the iPad.

Treat rendering as an asynchronous job, not a long synchronous HTTP request. Include progress/status, cancellation, timeouts, temporary-file cleanup, and limits for concurrent jobs.

Investigate the available OpenUtau rendering paths before choosing a permanent backend:
- Reuse compatible OpenUtau resampler/wavtool interfaces where they are required for voicebank compatibility.
- Evaluate the WORLD-based or other modern rendering path as a future option, rather than committing to a custom renderer before a baseline can sing.
- Do not assume Windows `.exe` resamplers can run on a Linux Render service. Each resampler and wavtool must be checked for platform support, license, and packaging requirements.

A first milestone is one correctly timed note/phrase rendered from a supported voicebank. Full-song rendering comes later.

### 5. C/C++ and WebAssembly — defer

WebAssembly is not a requirement for the initial release. Do not port DSP code to WASM merely because the client is Safari.

The existing CPython native extension is not directly usable in a browser. If a later requirement justifies browser-local DSP or offline operation, evaluate portable C/C++ modules compiled with Emscripten and integrated through JavaScript/Web Audio API. AudioWorklet/WASM is a later optimization, not a foundation dependency.

## Voicebank compatibility

Use OpenUtau's existing phonemizer behavior wherever possible. Do not create a parallel VoiceBankStudio phonemizer for supported formats.

Implement and test in this order:

1. Load voicebank metadata and oto.ini.
2. Resolve aliases and pitch mapping and use the oto parameters during phoneme/render preparation.
3. Support the relevant Japanese CV/VCV/CVVC workflows through reusable OpenUtau phonemizers.
4. Add oto.ini editing and assistance only after loading and playback are reliable.
5. Consider automatic oto generation as a later feature.

Keep voicebank loading/usage separate from the audio-analysis and oto-editing tools. Validate offset, consonant, cutoff, preutterance, overlap, alias selection, and pitch mapping.

## Licensing and dependency audit

Before copying or shipping code, record the exact upstream OpenUtau revision and review its license and notices. Audit dependencies individually, including transitive dependencies and any external resamplers/wavtools. Do not assume that every dependency has the same license as OpenUtau.

Preserve required copyright and license notices. Confirm whether each component can be redistributed and hosted in the intended server environment. In particular, do not bundle UTAU's original resampler or other third-party executables without verifying their license and redistribution terms.

## Deployment constraints

- Safari cannot run a desktop .NET application or native CPython extension directly.
- OpenUtau's Avalonia desktop UI is not a Safari UI.
- A server-side .NET service is the initial rendering target, subject to Linux/runtime/dependency compatibility checks.
- Render free/small server plans may not handle many simultaneous or long renders. Add job limits and measure memory/CPU before promising multi-track or real-time performance.
- Keep audio responses as WAV initially; optimize transport and caching after correctness is established.

## Development sequence

### Phase 0 — inventory and licensing
- Preserve `main` and the current analysis implementation.
- Record OpenUtau source revision, Core dependencies, licenses, and Linux compatibility.
- Identify the smallest Core components needed for a first render.

### Phase 1 — file and voicebank foundation
- Read and validate USTX.
- Load voicebank metadata and oto.ini.
- Resolve aliases and pitch mapping.
- Add synthetic-fixture tests; a user voicebank archive is not required for this phase.

### Phase 2 — Safari editor foundation
- Build the new editor shell separately from the current prototype.
- Add project state, tracks, piano roll, note/lyric editing, and save/load.
- Use mock render responses while the real engine is not connected.

### Phase 3 — first real render
- Host the selected OpenUtau Core components in a .NET service.
- Connect singer loading and Japanese phonemizer output.
- Render a single note/phrase and verify sample boundaries and timing.
- Add asynchronous render jobs and WAV playback.

### Phase 4 — full-song rendering and editing
- Add phrase rendering, caching, cancellation, multi-note and multi-track handling.
- Improve editing controls and project compatibility.
- Measure server resource use and enforce sensible limits.

### Phase 5 — iPad/Safari validation
- Test touch interactions, audio playback, long projects, backgrounding, and network failures on actual Safari/iPad.
- Switch the public Pages entry point only after the replacement is usable.

### Phase 6 — advanced tools
- Add oto editing assistance, audio analysis integration, optional DSP/WASM acceleration, and automatic oto generation as separate later milestones.

## Testing rules

- Test each feature before moving to the next.
- Separate unit tests, .NET service integration tests, browser tests, and actual iPad/Safari listening tests.
- Synthetic fixtures can validate parsing, alias selection, timing calculations, API contracts, and render scheduling.
- Never claim real voicebank singing is validated until an actual voicebank has been loaded and the resulting audio has been listened to.
- Record known limitations, especially unsupported resamplers, voicebank formats, and server resource limits.

## Current status

The feature branch now contains a separate .NET 10 HTTP service referencing the pinned OpenUtau Core/Builtin source, health/engine-status endpoints, and a ZIP voicebank inspection endpoint. The inspection path uses OpenUtau's `VoicebankLoader` and `ClassicSinger`, then invokes the built-in Japanese VCV and CVVC phonemizers across two notes to verify a VCV transition and CVVC's inserted VC transition. GitHub Actions is configured to build the service, exercise the endpoints with a synthetic CP932 voicebank, and reject ZIP path traversal. The service now has a headless OpenUtau host and `POST /api/v1/render`, which builds a note project, uses the built-in Worldline-R renderer, and returns PCM16 WAV. CI has verified a non-silent single-note WAV from a synthetic voicebank. Multi-note phrase mixing, rest timing, CVVC render behavior, and real voicebank quality are the next validation targets. The existing browser editor and public Pages deployment have not been replaced.
