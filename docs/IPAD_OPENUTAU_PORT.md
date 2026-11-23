# OpenUtau iPad / Safari Port Investigation

Date: 2026-11-23
Target branch: feature/openutau-safari-rebuild

## Decision

Build a browser-native OpenUtau-derived engine for iPad Safari. Do not try to run the Avalonia desktop application in Safari, and do not move the current .NET server binary into the browser unchanged.

The port should preserve OpenUtau's voicebank semantics, USTX/note model, Japanese phonemizers, oto timing, pitch mapping, and rendering behavior wherever possible. Browser-specific adapters and a browser-compatible DSP backend are required.

## What can be reused

- OpenUtau Core data structures and project semantics, after removing desktop-only dependencies.
- Built-in Japanese CV / VCV / CVVC phonemizers and their alias-selection logic, subject to dependency and browser build checks.
- Voicebank metadata, oto.ini parsing, prefix.map handling, and pitch/alias resolution.
- Managed rendering orchestration and envelope/timing logic where it does not depend on native process APIs.

The existing server host already proves that the pinned OpenUtau Core + Builtin projects can load synthetic voicebanks, run Japanese phonemizers, and render through Worldline-R on Linux. That is a useful compatibility oracle while porting.

## What cannot be carried over unchanged

1. Avalonia desktop UI and desktop window/audio-device services are not part of the Safari port.
2. The current Worldline bridge selects a platform-native DLL / dylib / SO. Safari cannot load those native libraries or call ordinary desktop P/Invoke.
3. Classic renderer integrations that launch arbitrary external resampler / wavtool executables are not directly available in a browser sandbox.
4. Desktop path discovery, global mutable managers, plugin discovery, and process-wide filesystem assumptions need browser adapters or isolation.
5. A 597 MB ZIP must not be read into one giant JavaScript ArrayBuffer and expanded fully in RAM. Browser import needs bounded/streamed extraction and persistent storage.

## Proposed browser architecture

```
Safari UI (HTML / JS)
  ├─ project editor and touch controls
  ├─ IndexedDB / OPFS voicebank store
  └─ Web Worker render coordinator
       ├─ OpenUtau-derived portable Core
       │    ├─ USTX / note model
       │    ├─ singer + oto + prefix.map
       │    └─ Japanese phonemizers
       └─ Worldline DSP compiled to WebAssembly
            └─ WAV encoder / PCM output
```

Use Web Audio API only for playback/monitoring, not as the source of truth for offline render timing. Keep rendering off the UI thread. Start with a single render worker; only add parallel phrase rendering after memory and timing measurements on the actual iPad.

## Worldline strategy

OpenUtau documents Worldline as its built-in cross-platform resampler, and its source calls the Worldline implementation through a managed wrapper. The Worldline implementation is C++ in the upstream repository.

The first browser DSP investigation should therefore be:
- inspect the exact pinned Worldline C++ source and all transitive native dependencies;
- determine whether it can be compiled with Emscripten to a standalone WASM module;
- identify filesystem, threading, SIMD, and native-library assumptions;
- expose a narrow C ABI for one phoneme render request and PCM response;
- connect the module to the browser host through a JS adapter.

Do not assume that a normal native Worldline binary can be used by Safari. Do not claim WASM success until an actual Emscripten build and audio fixture test pass.

## Port sequence

### Stage A — browser portability inventory
- Pin the upstream OpenUtau revision and record source/license notices.
- Build a dependency map for Core, Builtin phonemizers, Worldline wrapper, and Worldline C++.
- Mark every desktop-only API, P/Invoke, process launch, file path, and thread/scheduler dependency.
- Keep the existing Linux service as a behavioral oracle.

### Stage B — portable voicebank and phonemizer layer
- Extract a small browser-compatible library boundary around singer metadata, oto.ini, prefix.map, and Japanese CV/VCV/CVVC phonemizers.
- Replace desktop path access with a virtual voicebank filesystem backed by IndexedDB/OPFS.
- Preserve CP932/Shift-JIS text and ZIP filename decoding.
- Test expected aliases and oto timing against the current server implementation.

### Stage C — Worldline WASM proof
- Build a minimal Emscripten target from upstream Worldline C++.
- Render one known phoneme fixture and compare sample rate, duration, non-silence, and waveform properties with the native reference.
- Add pitch-shift and duration-change fixtures before integrating with full phrases.

### Stage D — iPad local render
- Run phonemizer + Worldline WASM in a Web Worker.
- Implement deterministic phrase scheduling, sample offsets, oto timing, overlap, envelopes, and WAV encoding.
- Store imported voicebanks persistently; do not require re-upload after reload.
- Validate on actual iPad Safari, including backgrounding and memory pressure.

### Stage E — compatibility expansion
- Add further phonemizers and renderer modes only after the VCV/CVVC Worldline path is stable.
- Treat arbitrary Windows UTAU resamplers as unsupported unless a compatible WASM/native-browser implementation and redistribution permission are confirmed.
- Retain the existing server-render path as fallback during beta.

## First acceptance target

On an iPad in Safari, with network disconnected after the page and engine assets are loaded:
1. Import a small Japanese VCV test voicebank.
2. Read its character metadata, oto.ini, and prefix.map locally.
3. Convert a two-note lyric sequence to the same aliases as the pinned OpenUtau server reference.
4. Render a short phrase locally through Worldline WASM.
5. Play and save a valid non-silent WAV.
6. Reload the page and reuse the locally stored voicebank.

The 597 MB multi-pitch bank is a later stress test, not the first acceptance fixture.

## Current status and honesty boundary

The deployed beta still performs singing renders on the .NET server. This document records the browser-port design and investigation tasks; it does not claim that local iPad singing is implemented yet. The next code milestone is a source/dependency inventory and a minimal Emscripten Worldline proof, not a UI toggle that pretends to render locally.

## Upstream references

- OpenUtau repository: https://github.com/openutau/OpenUtau
- OpenUtau compiling guide (Worldline is the C++ component): https://openutau.com/Compiling-from-source/
- OpenUtau Worldline wrapper: https://github.com/openutau/OpenUtau/blob/master/OpenUtau.Core/Classic/WorldlineResampler.cs
- OpenUtau renderer / resampler overview: https://github.com/openutau/OpenUtau/wiki/Resamplers-and-Wavtools
- OpenUtau license: MIT; audit dependency and native artifact licenses separately before redistribution.


## Source-level findings (pinned revision)

The current server branch pins upstream OpenUtau revision `08222cb7c48c4ab47faa34a6efc34e2c00898a1e`. Inspection of that revision found:

- `OpenUtau.Core.csproj` targets .NET 10 and references a broad desktop-oriented dependency set, including SDL3 bindings, DBus, System.Drawing, audio/file codecs, SharpCompress, NumSharp, and ONNX Runtime platform-specific packages. A browser build should not reference the full project unchanged.
- `OpenUtau.Core/Render/Worldline.cs` uses many `DllImport("worldline")` entry points. These include F0 analysis, WORLD analysis/synthesis, and related operations. The browser bridge must replace this native P/Invoke boundary; simply compiling the C# Core for WebAssembly is not sufficient.
- The C++ Worldline target is defined in `cpp/worldline/BUILD.bazel`. It depends on the Worldline common/F0/model libraries and the external WORLD library. The exported API is a relatively narrow C ABI, which is promising for a separate Emscripten module, but its dependencies still need to be checked for browser compatibility.
- The native C++ target currently builds a shared library for desktop platforms. The upstream build guide documents DLL/dylib/SO outputs, not an Emscripten target. Therefore WASM compilation remains an experiment, not a confirmed supported build.
- The C# Core also has direct desktop/process assumptions beyond Worldline. A reduced browser-targeted project or carefully maintained fork is more realistic than trying to compile the whole Core project.

### Updated implementation boundary

Do not start by porting the whole Core assembly. First create a small browser-targeted project containing only the portable note/phoneme/voicebank logic needed by Japanese CV/VCV/CVVC. Replace filesystem access with a virtual voicebank file provider and replace Worldline P/Invoke with a JS/WASM adapter. Keep unsupported desktop features out of this project.

### Immediate engineering task

Create an Emscripten build experiment for the pinned `cpp/worldline` target, initially exporting only the F0/WORLD analysis and synthesis functions required by the Worldline C# wrapper. Add a tiny deterministic input fixture and verify the output is finite, non-empty PCM. In parallel, compile a minimal .NET browser project containing one existing Japanese phonemizer and compare aliases against the existing server smoke test. These are independent proof points and should be kept separate until both pass.


## Server HTTP 429 diagnosis (2026-11-23)

Inspection of the current branch's `VoicebankRenderEndpoint.RenderAsync` found a direct application-level cause:

- The endpoint calls `EngineWorkGate.Gate.WaitAsync(0)`.
- `EngineWorkGate.Gate` is a `SemaphoreSlim(1, 1)`, so only one registration/render operation can hold it at a time.
- If another operation is still holding the gate, the render endpoint immediately returns HTTP 429. This is not, by itself, proof that Render's platform-wide inbound rate limiter rejected the request.
- The gate is also held during ZIP extraction, voicebank loading, rendering, and cleanup. A large voicebank can therefore occupy the only slot for a long time.
- Phrase-level parallelism inside one render is separate from request-level concurrency; the current two-phrase optimization does not allow a second HTTP render request.

This is a confirmed code path that can explain the user's 429. Before changing server concurrency, inspect request logs and client retries to determine whether overlapping requests are occurring. Do not simply increase the semaphore count: the OpenUtau host uses shared global managers and a single engine synchronization thread, so concurrent requests may corrupt shared project/singer/cache state.

## Revised port policy: preserve upstream C# and C++ first

The user's preference is to change OpenUtau as little as possible. Prefer a source-preserving browser port over reimplementing the synthesis engine:

1. Keep the pinned upstream OpenUtau C# Core and Builtin phonemizer source as intact as feasible. Introduce a browser-targeted build configuration and narrow adapter interfaces only where desktop APIs prevent compilation.
2. Include the upstream C++ Worldline source in the port. Add an Emscripten build target alongside the existing Bazel/native targets rather than replacing Worldline with a different DSP engine.
3. Replace only the native interop boundary: the current C# `DllImport("worldline")` calls cannot load a desktop shared library in Safari. Expose the same Worldline operations from a WASM module and bridge them through browser-compatible interop.
4. Keep source revisions pinned and maintain upstream license/copyright notices. Track any local patches separately so they can be rebased.
5. Avoid broad rewrites of pitch, phoneme, oto timing, overlap, envelope, or phrase scheduling. Add regression fixtures comparing browser output and the native server reference.

The Emscripten work is a feasibility milestone, not a claim that the current Bazel target can already be built for the browser. Its dependencies (including WORLD and Abseil-related code) must be verified and any unsupported platform calls isolated.

## Immediate next milestones

- Build a minimal Emscripten Worldline module from the pinned upstream C++ source, exporting the required analysis/synthesis ABI.
- Verify it against a deterministic WAV fixture in a normal desktop browser first, then iPad Safari.
- Build the closest feasible browser-targeted OpenUtau C# Core slice while preserving upstream source and phonemizer logic.
- Add tests proving the same Japanese VCV/CVVC aliases and timing are produced as the server reference.
- Only after both parts pass, connect the Core to the Worldline WASM bridge and attempt a short offline-rendered phrase.
