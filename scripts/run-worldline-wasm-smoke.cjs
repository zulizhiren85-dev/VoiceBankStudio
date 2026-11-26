const path = require("node:path");

async function main() {
  const modulePath = path.resolve(process.argv[2] || "");
  if (!process.argv[2]) {
    throw new Error("Pass the generated Emscripten JavaScript module path.");
  }

  const createModule = require(modulePath);
  if (typeof createModule !== "function") {
    throw new Error("The generated Emscripten module did not export a factory.");
  }

  const output = [];
  const instance = await createModule({
    print: (line) => {
      output.push(String(line));
      process.stdout.write(String(line) + "\n");
    },
    printErr: (line) => {
      process.stderr.write(String(line) + "\n");
    },
  });

  if (!instance || !output.some((line) => line.includes("WORLDLINE_WASM_SMOKE_OK"))) {
    throw new Error("Worldline WASM did not complete its DSP fixture successfully.");
  }

  process.stdout.write("WORLDLINE_WASM_NODE_SMOKE_OK\n");
}

main().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.stderr.write("\n");
  process.exitCode = 1;
});
