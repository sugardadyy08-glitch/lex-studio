import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

function ffmpegCoreWasmPlugin() {
  const virtualModules = new Map([
    ["virtual:ffmpeg-core-url", "\0virtual:ffmpeg-core-url"],
    ["virtual:ffmpeg-core-wasm-url", "\0virtual:ffmpeg-core-wasm-url"],
  ]);
  let command;
  let coreReference;
  let wasmReference;

  return {
    name: "ffmpeg-core-wasm",
    configResolved(config) {
      command = config.command;
    },
    async buildStart() {
      if (command !== "build") return;
      const wasmPath = fileURLToPath(
        new URL("./node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm", import.meta.url),
      );
      const corePath = fileURLToPath(
        new URL("./node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js", import.meta.url),
      );
      const wasm = await readFile(wasmPath);
      const core = await readFile(corePath);
      coreReference = this.emitFile({
        type: "asset",
        fileName: "assets/ffmpeg-core.js",
        source: core,
      });
      wasmReference = this.emitFile({
        type: "asset",
        fileName: "assets/ffmpeg-core.wasm.gz",
        source: gzipSync(wasm, { level: 9 }),
      });
    },
    resolveId(id) {
      return virtualModules.get(id) ?? null;
    },
    load(id) {
      const entry = [...virtualModules.entries()].find(([, resolvedId]) => resolvedId === id);
      if (!entry) return null;
      const [virtualId] = entry;
      if (command === "serve") {
        return virtualId === "virtual:ffmpeg-core-url"
          ? 'export { default } from "@ffmpeg/core?url";'
          : 'export { default } from "@ffmpeg/core/wasm?url";';
      }
      const referenceId = virtualId === "virtual:ffmpeg-core-url"
        ? coreReference
        : wasmReference;
      return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ffmpegCoreWasmPlugin()],
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg"],
  },
});
