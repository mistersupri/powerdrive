// Copies the OCR engine (worker, WebAssembly core, Indonesian + English language data) into public/ocr so the app
// never has to fetch them from a CDN: scanned PDFs are recognised in the browser, offline-capable and private.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "public", "ocr");
const require = createRequire(import.meta.url);
const dirOf = (pkg, from) => path.dirname(require.resolve(`${pkg}/package.json`, from ? { paths: [from] } : undefined));

mkdirSync(path.join(out, "lang"), { recursive: true });
const tess = dirOf("tesseract.js");
copyFileSync(path.join(tess, "dist", "worker.min.js"), path.join(out, "worker.min.js"));
const core = dirOf("tesseract.js-core", tess);
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) copyFileSync(path.join(core, f), path.join(out, f));
for (const lang of ["eng", "ind"]) {
  const dir = path.join(dirOf(`@tesseract.js-data/${lang}`), "4.0.0_best_int");
  if (!existsSync(dir)) throw new Error(`Missing language data: ${dir}`);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".traineddata.gz"))) copyFileSync(path.join(dir, f), path.join(out, "lang", f));
}
console.log("OCR assets copied to public/ocr");
