# OpenUtau Core feasibility investigation

Date: 2026-11-22
Target branch: feature/openutau-safari-rebuild

## Executive conclusion

A server-side OpenUtau-based singing service is a realistic direction, but it is not yet proven that the full OpenUtau Core can be hosted as a small headless service without adaptation.

The strongest initial path is:

1. Keep the current Python FastAPI analysis service unchanged.
2. Add a separate .NET 10 service in a Docker-based Render service.
3. Start by referencing OpenUtau.Core and OpenUtau.Plugin.Builtin, not the Avalonia desktop application.
4. Build a narrow proof of concept that loads one singer, invokes the Japanese VCV/CVVC phonemizer, and renders one short phrase using the built-in Worldline renderer.
5. Only after that succeeds, design the production render-job API and connect Safari.

## Findings from upstream source inspection

### Runtime and project structure

- Current upstream `OpenUtau.Core.csproj` targets `.NET 10`.
- `OpenUtau.Plugin.Builtin.csproj` also targets `.NET 10` and references `OpenUtau.Core`.
- The built-in plugin project contains Japanese phonemizer implementations, including `JapaneseVCVPhonemizer.cs` and `JapaneseCVVCPhonemizer.cs`.
- The desktop application is a separate project and its Avalonia UI is not needed for the Safari client.
- Core has many package dependencies. The Linux-specific project condition currently adds `Microsoft.ML.OnnxRuntime.Gpu.Linux`; this needs investigation because it may be unnecessary or costly for a classic UTAU voicebank render, and must not be blindly removed without checking code paths.

### Render environment

The existing Render service is a native Python runtime configured by `render.yaml`. Render's native language runtimes do not include .NET; its documented route for .NET is a Docker-based service. Therefore, do not add .NET commands to the existing Python service. Keep that service intact and deploy a separate Docker service for the .NET engine.

### Rendering components

- OpenUtau's `ClassicRenderer` builds per-phoneme resampler items, runs resampling, then concatenates the results with a wavtool.
- `SharpWavtool` contains managed C# concatenation logic, including offsets, cutoffs, envelopes, and phase-compensation behavior.
- `WorldlineResampler` calls the native Worldline library through the managed Core layer.
- The upstream repository contains native Worldline binaries for Linux x64 and Linux arm64 under `runtimes/`.
- The upstream resampler guide lists Worldline as built-in and cross-platform, including Linux. This makes it a better first candidate than a Windows-only external UTAU executable.
- External resamplers remain optional compatibility work. Each executable/library must be checked for OS compatibility, process invocation behavior, and redistribution license.

### Licensing

The OpenUtau repository's top-level license is MIT. That does not automatically license every dependency, model, native binary, external resampler, or voicebank. Keep upstream notices and perform a separate dependency and asset audit before redistribution.

## Risks that must be tested

1. **Headless initialization:** Core code references global managers and application paths/preferences. Determine which services can be initialized without the Avalonia desktop app.
2. **Singer loading:** Confirm voicebank paths, archive extraction, encoding detection, character metadata, and oto.ini loading work in a server process.
3. **Phonemizer discovery:** Determine whether the built-in plugin assembly can be loaded without desktop-only startup code, and register only the required Japanese phonemizers.
4. **Worldline native library:** Confirm Linux x64 native library resolution and all required system libraries inside the Docker image.
5. **ONNX dependencies:** Determine whether the GPU ONNX runtime package is needed for the selected classic UTAU path. Do not remove it until the dependency path is understood.
6. **Filesystem isolation:** Give every render job a private temporary workspace; never share mutable voicebank or cache files across untrusted jobs.
7. **Resource limits:** Add bounded concurrency, duration/file-size limits, cancellation, timeouts, and cleanup before accepting public uploads.
8. **License scope:** Audit transitive NuGet packages, native Worldline artifacts, third-party resamplers, and the voicebank's own terms separately.

## First proof-of-concept acceptance criteria

A minimal .NET console/service host should be able to:

- Start on Linux x64 without launching Avalonia or opening a GUI/audio device.
- Report its OpenUtau source revision and engine version.
- Load a test voicebank folder containing a small synthetic fixture.
- Parse its character metadata and oto.ini.
- Instantiate the Japanese VCV phonemizer and produce expected phoneme aliases for a short note sequence.
- Render one short phrase with the built-in Worldline path.
- Return a valid WAV with the expected sample rate, channel count, non-zero audio, and plausible duration.
- Exit cleanly and remove its temporary job directory.

The first POC should use synthetic fixtures or a freely redistributable test voicebank. Do not depend on a user-provided voicebank archive.

## Proposed next implementation step

Create an isolated `engine-dotnet/` proof-of-concept project and a dedicated Dockerfile. Pin OpenUtau to a specific upstream commit rather than tracking `master`. Start with a reference to the Core and Builtin projects and add only the minimal host/API code needed to test initialization, singer loading, phonemization, and a one-phrase render.

Do not yet modify the existing Render Python service, public Pages entry point, or main branch. If a full Core reference cannot be initialized headlessly, reduce the POC to a smaller adapter/fork boundary and document the exact desktop-only dependencies before attempting broad refactoring.

## Sources inspected

- OpenUtau upstream Core project: `OpenUtau.Core/OpenUtau.Core.csproj`
- Built-in phonemizer project: `OpenUtau.Plugin.Builtin/OpenUtau.Plugin.Builtin.csproj`
- Japanese phonemizers: `OpenUtau.Plugin.Builtin/JapaneseVCVPhonemizer.cs`, `JapaneseCVVCPhonemizer.cs`
- Classic render path: `OpenUtau.Core/Classic/ClassicRenderer.cs`, `SharpWavtool.cs`, `WorldlineResampler.cs`
- Native Worldline runtime assets: `runtimes/linux-x64/native/libworldline.so`, `runtimes/linux-arm64/native/libworldline.so`
- OpenUtau license: `LICENSE.txt`
- Render deployment docs: Docker is supported; .NET is deployed through Docker rather than a native language runtime.
