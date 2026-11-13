import { db, now } from "./db.ts";
import { testConnection } from "./modules/storages.ts";
import { pruneThumbnailCache } from "./modules/thumbnails.ts";
import { sweepStaleUploads } from "./modules/uploads.ts";

/** Background upkeep. Everything here is safe to skip or repeat. */
export function startScheduler(log: { info: (o: any, m?: string) => void; warn: (o: any, m?: string) => void }) {
  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, name: string, fn: () => Promise<unknown> | unknown) => {
    const run = async () => { try { await fn(); } catch (e) { log.warn({ err: e }, `scheduler: ${name} failed`); } };
    const t = setInterval(run, ms); t.unref(); timers.push(t);
    return run;
  };
  every(60 * 60_000, "sweep-uploads", sweepStaleUploads);
  every(60 * 60_000, "sweep-sessions", () => { db.run("DELETE FROM sessions WHERE expires_at < ?", now()); db.run("DELETE FROM oauth_states WHERE expires_at < ?", now()); db.run("DELETE FROM password_resets WHERE expires_at < ?", now()); });
  every(24 * 3600_000, "prune-thumbnails", () => pruneThumbnailCache(60));
  // Refresh status + quota so the dashboard stays honest without anyone clicking "test".
  every(30 * 60_000, "refresh-storages", async () => {
    for (const s of db.all<{ id: string }>("SELECT id FROM storages WHERE status IN ('CONNECTED','ERROR')")) await testConnection(s.id).catch(() => {});
  });
  void sweepStaleUploads();
  return () => timers.forEach(clearInterval);
}
