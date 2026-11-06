import { builtinModules } from "node:module";
import { defineConfig } from "vite";

/**
 * The CLI bundle: one ESM file with a shebang, no local imports, so it can be
 * copied to `/usr/bin/notty` by the Debian package. Node builtins stay
 * external and the host's Node runs it.
 */
export default defineConfig({
  build: {
    outDir: "dist-cli",
    emptyOutDir: true,
    target: "node20",
    minify: false,
    sourcemap: false,
    lib: {
      entry: "src/cli/main.ts",
      formats: ["es"],
      fileName: () => "notty.js",
    },
    rollupOptions: {
      external: [/^node:/, ...builtinModules],
      output: {
        banner: "#!/usr/bin/env node",
        codeSplitting: false,
      },
    },
  },
});
