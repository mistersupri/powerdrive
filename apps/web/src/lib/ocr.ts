import type { Worker } from "tesseract.js";

/** Browser-side OCR (Indonesian + English). The engine and language data are served by this app itself, see scripts/copy-ocr.mjs. */
export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number }
export interface OcrResult { text: string; words: OcrWord[]; width: number; height: number }

const base = () => `${new URL(import.meta.env.BASE_URL || "/", location.href).href.replace(/\/$/, "")}/ocr`;
let worker: Promise<Worker> | null = null;
function getWorker() {
  worker ??= import("tesseract.js").then(({ createWorker }) => createWorker(["ind", "eng"], 1, { workerPath: `${base()}/worker.min.js`, corePath: base(), langPath: `${base()}/lang` }))
    .catch((e) => { worker = null; throw e; });
  return worker;
}

// One page at a time: the engine is single-threaded and a long queue should not starve the page being looked at.
let chain: Promise<unknown> = Promise.resolve();
/** Recognises the text on [canvas]. [skip] is asked right before the work starts, so pages scrolled past can be dropped. */
export function recognize(canvas: HTMLCanvasElement, skip: () => boolean): Promise<OcrResult | null> {
  const job = chain.then(async () => {
    if (skip()) return null;
    const w = await getWorker();
    const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
    const words: OcrWord[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words) if (wd.text.trim()) words.push({ text: wd.text, ...wd.bbox });
    return { text: data.text, words, width: canvas.width, height: canvas.height };
  });
  chain = job.catch(() => {});
  return job;
}
