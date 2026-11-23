#include "worldline.h"

#include <algorithm>
#include <cmath>
#include <vector>

// Browser-facing, allocation-free C ABI. The caller owns input/output memory.
// This is a DSP primitive, not the complete OpenUtau Resample pipeline.
extern "C" {

int vbs_worldline_output_capacity(int sample_count, int sample_rate) {
  if (sample_count <= 0 || sample_rate < 8000 || sample_rate > 192000) return 0;
  constexpr int hop = 220;
  constexpr double frame_ms = static_cast<double>(hop) * 1000.0 / 44100.0;
  const int frames = F0FrameCount(sample_count, sample_rate, frame_ms, 0);
  if (frames <= 0) return 0;
  return WorldSynthesisSampleCount(frames, frame_ms, sample_rate);
}

// Returns rendered sample count, or a negative error code:
// -1 invalid arguments, -2 insufficient output capacity, -3 no voiced frames,
// -4 analysis/synthesis failure.
int vbs_worldline_render_pitch_shift(
    const float* input, int sample_count, int sample_rate, int target_midi_tone,
    double* output, int output_capacity) {
  if (!input || !output || sample_count <= 0 || sample_rate < 8000 ||
      sample_rate > 192000 || target_midi_tone < 24 || target_midi_tone > 108) {
    return -1;
  }

  constexpr int hop = 220;
  constexpr int fft_size = 2048;
  const double frame_ms = static_cast<double>(hop) * 1000.0 / sample_rate;
  const int frame_capacity = F0FrameCount(sample_count, sample_rate, frame_ms, 0);
  if (frame_capacity <= 0) return -4;

  std::vector<double> f0(frame_capacity);
  const int frames = F0(input, sample_count, sample_rate, frame_ms, 0, f0.data());
  if (frames <= 0 || frames > frame_capacity) return -4;
  f0.resize(frames);

  std::vector<double> voiced;
  voiced.reserve(frames);
  for (double value : f0) {
    if (std::isfinite(value) && value >= 40.0 && value <= 1200.0) {
      voiced.push_back(value);
    }
  }
  if (voiced.empty()) return -3;
  const auto middle = voiced.begin() + voiced.size() / 2;
  std::nth_element(voiced.begin(), middle, voiced.end());
  const double source_median_hz = *middle;
  const double target_hz = 440.0 * std::pow(2.0, (target_midi_tone - 69) / 12.0);
  const double ratio = target_hz / source_median_hz;

  const int bins = fft_size / 2 + 1;
  AnalysisConfig config{};
  InitAnalysisConfig(&config, sample_rate, hop, fft_size);
  std::vector<double> spectrum(static_cast<size_t>(frames) * bins);
  std::vector<double> aperiodicity(static_cast<size_t>(frames) * bins);
  WorldAnalysisF0In(&config, input, sample_count, f0.data(), frames,
                    spectrum.data(), aperiodicity.data());

  for (double& value : f0) {
    if (std::isfinite(value) && value > 0.0) value *= ratio;
  }

  const int required = WorldSynthesisSampleCount(frames, frame_ms, sample_rate);
  if (required <= 0) return -4;
  if (output_capacity < required) return -2;
  const int rendered = WorldSynthesis(
      f0.data(), frames, spectrum.data(), false, bins, aperiodicity.data(),
      false, fft_size, frame_ms, sample_rate, output, nullptr, nullptr, nullptr,
      nullptr);
  return rendered == required ? rendered : -4;
}

}  // extern "C"
