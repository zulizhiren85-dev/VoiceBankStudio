#include "worldline.h"

#include <cmath>
#include <cstdio>
#include <vector>

int main() {
  constexpr int fs = 44100;
  constexpr int hop = 220;
  constexpr int fft_size = 2048;
  constexpr double frame_ms = static_cast<double>(hop) * 1000.0 / fs;
  constexpr int sample_count = fs / 4;

  std::vector<float> input(sample_count);
  for (int i = 0; i < sample_count; ++i) {
    input[i] = static_cast<float>(0.2 * std::sin(
        2.0 * 3.14159265358979323846 * 220.0 * i / fs));
  }

  const int capacity = F0FrameCount(sample_count, fs, frame_ms, 0);
  if (capacity <= 0) {
    std::fprintf(stderr, "F0FrameCount returned %d\n", capacity);
    return 1;
  }

  std::vector<double> f0(capacity);
  const int frames = F0(input.data(), sample_count, fs, frame_ms, 0, f0.data());
  if (frames <= 0 || frames > capacity) {
    std::fprintf(stderr, "F0 returned invalid frame count %d/%d\n", frames, capacity);
    return 2;
  }

  int voiced = 0;
  double f0_sum = 0;
  for (int i = 0; i < frames; ++i) {
    if (std::isfinite(f0[i]) && f0[i] > 100.0 && f0[i] < 400.0) {
      ++voiced;
      f0_sum += f0[i];
    }
  }
  if (voiced < frames / 3 || voiced == 0) {
    std::fprintf(stderr, "F0 produced too few voiced frames: %d/%d\n", voiced, frames);
    return 3;
  }
  const double mean_f0 = f0_sum / voiced;
  if (mean_f0 < 190.0 || mean_f0 > 250.0) {
    std::fprintf(stderr, "Unexpected F0 mean: %.2f Hz\n", mean_f0);
    return 4;
  }

  AnalysisConfig config{};
  InitAnalysisConfig(&config, fs, hop, fft_size);
  const int bins = fft_size / 2 + 1;
  std::vector<double> spectrum(static_cast<size_t>(frames) * bins);
  std::vector<double> aperiodicity(static_cast<size_t>(frames) * bins);
  WorldAnalysisF0In(&config, input.data(), sample_count, f0.data(), frames,
                    spectrum.data(), aperiodicity.data());

  const int output_count = WorldSynthesisSampleCount(frames, frame_ms, fs);
  if (output_count <= 0) {
    std::fprintf(stderr, "Invalid synthesis sample count: %d\n", output_count);
    return 5;
  }
  std::vector<double> output(output_count);
  const int rendered = WorldSynthesis(
      f0.data(), frames, spectrum.data(), false, bins, aperiodicity.data(),
      false, fft_size, frame_ms, fs, output.data(), nullptr, nullptr, nullptr,
      nullptr);
  if (rendered != output_count) {
    std::fprintf(stderr, "Synthesis length mismatch: %d/%d\n", rendered, output_count);
    return 6;
  }

  double peak = 0;
  for (double sample : output) {
    if (!std::isfinite(sample)) {
      std::fprintf(stderr, "Synthesis returned non-finite PCM\n");
      return 7;
    }
    peak = std::max(peak, std::abs(sample));
  }
  if (peak <= 1e-8) {
    std::fprintf(stderr, "Synthesis returned silent PCM\n");
    return 8;
  }

  std::printf("WORLDLINE_WASM_SMOKE_OK f0=%.2fHz frames=%d samples=%d peak=%.6f\n",
              mean_f0, frames, rendered, peak);
  return 0;
}
