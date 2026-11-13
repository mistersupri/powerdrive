import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Boots an isolated app (own data dir + in-memory db) for a test file. Must run before any app module is imported. */
export async function bootstrap() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-test-"));
  process.env.DATA_DIR = dir;
  process.env.DATABASE_FILE = ":memory:";
  process.env.UPLOADS_DIR = path.join(dir, "files");
  process.env.NODE_ENV = "test";
  process.env.TRANSFER_RETRY_BASE_MS = "20";
  const { buildApp } = await import("../app.ts");
  const { openDb } = await import("../db.ts");
  const { engine } = await import("../modules/transfers.ts");
  openDb(":memory:");
  const app = await buildApp({ logger: false });
  engine.start();

  const H = { "x-requested-with": "superdrive" };
  const cookies = new Map<string, string>();
  async function call(who: string, method: string, url: string, payload?: any, headers: Record<string, string> = {}) {
    const isBuf = Buffer.isBuffer(payload);
    const res = await app.inject({
      method: method as any, url: `/api/v1${url}`, payload: isBuf ? payload : payload === undefined ? undefined : JSON.stringify(payload),
      headers: { ...H, ...(who && cookies.get(who) ? { cookie: cookies.get(who)! } : {}), ...(!isBuf && payload !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    });
    const set = res.headers["set-cookie"];
    if (set) cookies.set(who, String(Array.isArray(set) ? set[0] : set).split(";")[0]!);
    let body: any = null; try { body = res.json(); } catch { /* binary */ }
    return { status: res.statusCode, body, res, data: body?.data };
  }
  const register = (who: string, extra: any = {}) => call(who, "POST", "/auth/register", { email: `${who}@example.com`, name: who, password: "password123", ...extra });
  const wait = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 25)); }
    throw new Error("timeout waiting for condition");
  };
  return { app, dir, call, register, wait, engine, root: path.join(dir, "files") };
}
