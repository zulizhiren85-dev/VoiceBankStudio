# VoiceBankStudio — OpenUtau-based Safari Rebuild

## Goal

Rebuild the editing and singing workflow around OpenUtau's proven project, phonemizer, voicebank, resampler, wavtool, and rendering concepts. The primary client remains Safari on iPad. Keep the current main branch intact while the replacement is developed on a separate branch.

This is a compatibility-oriented rebuild, not a claim that the desktop OpenUtau application can run unchanged inside Safari.

## Proposed hybrid architecture

### 1. Safari client — JavaScript / HTML / CSS

- Touch-friendly piano roll and timeline.
- Note, lyric, phoneme, track, tempo, and voicebank editing.
- Project save/load and undo/redo.
- Audio preview and playback using Web Audio API.
- Communicate with processing services through a versioned API.
- Keep the UI responsive while rendering runs asynchronously.

### 2. Compatibility and synthesis service — .NET where it preserves OpenUtau code

OpenUtau's core is C#/.NET. Prefer reusing compatible OpenUtau Core components behind a service boundary over manually rewriting complex phonemizer and rendering logic in Python or JavaScript.

- Inspect and isolate the smallest reusable OpenUtau Core modules.
- Preserve upstream license notices and audit third-party dependencies individually.
- Expose project, singer, phonemizer, render-job, progress, cancellation, and audio-result APIs.
- Run as a separate service/container if it cannot safely share the existing Python service.

### 3. Python — API orchestration and analysis

- Keep the existing FastAPI audio-analysis API as a separate responsibility.
- Handle upload validation, job coordination, metadata inspection, and analysis workflows.
- Do not reimplement OpenUtau's phonemizer or renderer in Python merely to avoid .NET.

### 4. C/C++ — DSP and browser acceleration

- Retain portable DSP code where useful.
- For browser-local compute, compile suitable C/C++ modules to WebAssembly with Emscripten.
- Use JavaScript/Web Audio API for browser integration; evaluate AudioWorklet/WASM only after basic Safari playback works.
- Do not assume desktop-native C extensions can run in Safari; Python extension modules and browser WebAssembly are different build targets.

## Important platform constraints

- Safari cannot load a native Python extension or desktop executable directly.
- A C extension built for CPython is not a WebAssembly module.
- WebAssembly can run in Safari, but browser APIs and real-time audio integration require JavaScript glue.
- OpenUtau's desktop UI is based on Avalonia and is not a drop-in Safari UI.
- OpenUtau Core targets modern .NET; compatibility, runtime packaging, and external resampler execution must be checked before choosing server-side deployment.
- Avoid depending on long-running synchronous HTTP requests for rendering. Use render jobs with status/progress and cancellable work.

## Migration stages

1. **Inventory and preservation**
   - Keep the current main branch and existing analysis engine.
   - Document current endpoints, project data, and tests.
   - Record OpenUtau source revision and license/dependency inventory.

2. **OpenUtau compatibility foundation**
   - Study project/note/track models, singer/voicebank loading, oto parsing, phonemizer API, resampler interfaces, wavtool, and render pipeline.
   - Add compatibility tests using synthetic fixtures; real voicebank archives are not required for this stage.
   - Choose which components run in .NET service and which DSP routines can be ported to C/WASM.

3. **Safari editor shell**
   - Build the new editor separately from the existing prototype.
   - Implement touch piano roll, note/lyric editing, track controls, and project serialization.
   - Use mock render responses until the real renderer is connected.

4. **Voicebank and phonemizer**
   - Implement voicebank import and oto compatibility.
   - Add Japanese CV/VCV/CVVC behavior through compatible OpenUtau components.
   - Test aliases, pitch mapping, preutterance, overlap, consonant, offset, and cutoff with generated fixtures.

5. **Rendering**
   - Connect the OpenUtau-compatible renderer.
   - Add resampler and wavtool support, phrase pre-rendering, caching, cancellation, and playback.
   - Validate note timing and sample boundaries before tuning voice quality.

6. **Integration and release**
   - Connect the editor to the service APIs.
   - Run automated tests and Safari/iPad manual tests.
   - Switch the public Pages entry point only after the replacement is usable.

## Testing rules

- Test every feature before moving on.
- Clearly distinguish unit tests, service integration tests, and actual iPad/Safari playback tests.
- Do not claim real voicebank singing has been validated without a real voicebank archive and listening test.
- Synthetic fixtures can validate parsing, timing math, API contracts, and render scheduling without user voicebank files.

## Current status

Planning and source inspection only. No replacement editor or OpenUtau renderer has been integrated yet.
