import { Readable } from "node:stream";
import { ProviderError } from "./types.ts";

/** Counting semaphore: limits concurrent calls to one provider account. */
export class Semaphore {
  private q: (() => void)[] = [];
  private n = 0;
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.n >= this.max) await new Promise<void>((r) => this.q.push(r));
    this.n++;
    try { return await fn(); } finally { this.n--; this.q.shift()?.(); }
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); rej(signal.reason ?? new Error("aborted")); }, { once: true });
  });

export interface FetchOpts extends Omit<RequestInit, "body"> {
  body?: BodyInit | Readable | null;
  retries?: number;
  timeoutMs?: number;
  sem?: Semaphore;
  /** Statuses that should NOT throw (e.g. 404 handled by caller). */
  okStatuses?: number[];
}

function mapStatus(status: number, text: string): ProviderError {
  const msg = `HTTP ${status}: ${text.slice(0, 300)}`;
  if (status === 401) return new ProviderError(msg, "auth", status);
  if (status === 403 && /quota|storageQuotaExceeded|insufficient/i.test(text)) return new ProviderError(msg, "quota", status);
  if (status === 403) return new ProviderError(msg, /rateLimit|too many/i.test(text) ? "rate" : "auth", status);
  if (status === 404) return new ProviderError(msg, "not_found", status);
  if (status === 409 || status === 412) return new ProviderError(msg, "conflict", status);
  if (status === 507) return new ProviderError(msg, "quota", status);
  if (status === 429) return new ProviderError(msg, "rate", status);
  return new ProviderError(msg, status >= 500 ? "network" : "other", status);
}

/** fetch with timeout, bounded retries, Retry-After handling and error mapping. */
export async function request(url: string, o: FetchOpts = {}): Promise<Response> {
  const { retries = 3, timeoutMs = 60_000, sem, okStatuses = [], body, ...init } = o;
  // Streams cannot be replayed, so they are sent once.
  const replayable = !(body instanceof Readable);
  let attempt = 0;
  for (;;) {
    const exec = async () => {
      const signals = [AbortSignal.timeout(timeoutMs)];
      if (init.signal) signals.push(init.signal);
      const reqInit: any = { ...init, signal: AbortSignal.any(signals), body: body instanceof Readable ? Readable.toWeb(body) : body };
      if (body instanceof Readable) reqInit.duplex = "half";
      return fetch(url, reqInit);
    };
    try {
      const res = sem ? await sem.run(exec) : await exec();
      if (res.ok || okStatuses.includes(res.status)) return res;
      const text = await res.text().catch(() => "");
      const err = mapStatus(res.status, text);
      if (replayable && (err.kind === "rate" || (res.status >= 500)) && attempt < retries) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(ra > 0 ? ra * 1000 : Math.min(30_000, 500 * 2 ** attempt) * (0.5 + Math.random()), init.signal ?? undefined);
        attempt++; continue;
      }
      throw err;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (init.signal?.aborted) throw e;
      if (replayable && attempt < retries) {
        await sleep(Math.min(10_000, 400 * 2 ** attempt) * (0.5 + Math.random()), init.signal ?? undefined);
        attempt++; continue;
      }
      throw new ProviderError(`Koneksi ke penyedia gagal: ${(e as Error).message}`, "network");
    }
  }
}

export async function json<T = any>(url: string, o: FetchOpts = {}): Promise<T> {
  const res = await request(url, o);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function streamOf(res: Response): Readable {
  if (!res.body) return Readable.from([]);
  return Readable.fromWeb(res.body as any, { highWaterMark: 1024 * 1024 });
}
