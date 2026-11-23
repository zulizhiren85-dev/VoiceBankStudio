const path = require("node:path");

async function main() {
  const modulePath = path.resolve(process.argv[2] || "");
  if (!process.argv[2]) throw new Error("Pass the generated Worldline API module path.");
  const createModule = require(modulePath);
  const module = await createModule({ printErr: (line) => process.stderr.write(String(line) + "\n") });
  const capacityFor = module.cwrap("vbs_worldline_output_capacity", "number", ["number", "number"]);
  const render = module.cwrap("vbs_worldline_render_pitch_shift", "number",
    ["number", "number", "number", "number", "number", "number"]);

  const sampleRate = 44100;
  const sampleCount = sampleRate / 4;
  const inputPtr = module._malloc(sampleCount * Float32Array.BYTES_PER_ELEMENT);
  const capacity = capacityFor(sampleCount, sampleRate);
  if (!capacity) throw new Error("Worldline API returned an invalid output capacity.");
  const outputPtr = module._malloc(capacity * Float64Array.BYTES_PER_ELEMENT);
  if (!inputPtr || !outputPtr) throw new Error("WASM memory allocation failed.");

  try {
    const input = new Float32Array(module.HEAPF32.buffer, inputPtr, sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      input[i] = 0.2 * Math.sin(2 * Math.PI * 220 * i / sampleRate);
    }
    const rendered = render(inputPtr, sampleCount, sampleRate, 69, outputPtr, capacity);
    if (rendered <= 0 || rendered > capacity) {
      throw new Error("Worldline API render failed: " + rendered);
    }
    const output = new Float64Array(module.HEAPF64.buffer, outputPtr, rendered);
    let peak = 0;
    let crossings = 0;
    let previous = output[0];
    for (let i = 0; i < rendered; i++) {
      const value = output[i];
      if (!Number.isFinite(value)) throw new Error("Non-finite output PCM.");
      peak = Math.max(peak, Math.abs(value));
      if (i > sampleRate / 50 && i < rendered - sampleRate / 50 &&
          previous <= 0 && value > 0) crossings++;
      previous = value;
    }
    const duration = (rendered - 2 * (sampleRate / 50)) / sampleRate;
    const estimatedHz = crossings / duration;
    if (peak <= 1e-8) throw new Error("Worldline API returned silence.");
    if (estimatedHz < 390 || estimatedHz > 490) {
      throw new Error("Expected pitch near A4 (440 Hz), got " + estimatedHz.toFixed(1) + " Hz.");
    }
    process.stdout.write("WORLDLINE_WASM_API_OK samples=" + rendered +
      " peak=" + peak.toFixed(6) + " estimatedHz=" + estimatedHz.toFixed(1) + "\n");
  } finally {
    module._free(outputPtr);
    module._free(inputPtr);
  }
}

main().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.stderr.write("\n");
  process.exitCode = 1;
});
