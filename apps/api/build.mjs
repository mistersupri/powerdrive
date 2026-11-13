// Bundles the API into one file. Third-party packages stay external (installed in the image);
// workspace packages (@superdrive/shared is TypeScript source) are inlined.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@superdrive/"));
await build({
  entryPoints: ["src/server.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: "dist/server.mjs", sourcemap: true, logLevel: "info",
  external: [...external, ...external.map((d) => `${d}/*`)],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
