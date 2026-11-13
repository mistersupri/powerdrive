import { db, now } from "../db.ts";
import { TRASH } from "../providers/pathutil.ts";
import { ROOT, type RemoteFile } from "../providers/types.ts";
import { indexItems } from "./files.ts";
import { providerFor } from "./storages.ts";

/**
 * Background crawler that fills the metadata index for a whole storage, so global search finds files in folders nobody
 * has opened yet (Google Drive, NAS, S3…). One storage at a time, gentle on provider rate limits, restart-safe.
 */
const queue: string[] = [];
const running = new Set<string>();
let busy = false;
let log: { warn: (o: unknown, m?: string) => void } = { warn: () => {} };
export const setIndexerLog = (l: typeof log) => { log = l; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function scheduleIndex(storageId: string) {
  if (running.has(storageId) || queue.includes(storageId)) return;
  db.run("INSERT INTO index_state(storage_id,status) VALUES (?, 'RUNNING') ON CONFLICT(storage_id) DO UPDATE SET status='RUNNING', error=NULL", storageId);
  queue.push(storageId); void pump();
}

async function pump() {
  if (busy) return; busy = true;
  try { while (queue.length) { const id = queue.shift()!; running.add(id); try { await crawl(id); } catch (e) { db.run("UPDATE index_state SET status='FAILED', finished_at=?, error=? WHERE storage_id=?", now(), (e as Error).message.slice(0, 300), id); } finally { running.delete(id); } } }
  finally { busy = false; }
}

async function crawl(storageId: string) {
  const row = db.get<any>("SELECT * FROM storages WHERE id = ?", storageId);
  if (!row || row.status !== "CONNECTED") { db.run("UPDATE index_state SET status='IDLE' WHERE storage_id = ?", storageId); return; }
  const p = providerFor(row); const started = now(); const remote = row.provider !== "LOCAL";
  db.run("UPDATE index_state SET status='RUNNING', started_at=?, finished_at=NULL, folders_scanned=0, files_indexed=0, error=NULL WHERE storage_id=?", started, storageId);
  const stack: string[] = [ROOT]; let folders = 0, files = 0, errors = 0; let lastErr = "";
  while (stack.length) {
    const folder = stack.pop()!;
    try {
      const all: RemoteFile[] = []; let token: string | null = null;
      do { const page = await p.list(folder, { pageToken: token, limit: 1000 }); all.push(...page.items); token = page.nextPageToken; } while (token);
      const items = folder === ROOT ? all.filter((i) => i.name !== TRASH) : all;
      indexItems(storageId, folder, items, { complete: true });
      for (const f of items) if (f.isFolder) stack.push(f.id);
      folders++; files += items.filter((i) => !i.isFolder).length;
      if (folders % 5 === 0) db.run("UPDATE index_state SET folders_scanned=?, files_indexed=? WHERE storage_id=?", folders, files, storageId);
    } catch (e) { errors++; lastErr = (e as Error).message; log.warn({ storageId, folder, err: lastErr }, "index: folder skipped"); }
    // Stay polite to cloud APIs and keep the event loop free for people.
    await sleep(remote ? 60 : 0);
  }
  // Anything not seen in a complete crawl no longer exists (e.g. children of a deleted folder).
  if (!errors) db.run("DELETE FROM files WHERE storage_id = ? AND indexed_at < ?", storageId, started);
  db.run("UPDATE index_state SET status=?, finished_at=?, folders_scanned=?, files_indexed=?, error=? WHERE storage_id=?", errors ? "PARTIAL" : "DONE", now(), folders, files, errors ? `${errors} folder dilewati: ${lastErr}`.slice(0, 300) : null, storageId);
}

export function indexInfo(storageId: string) {
  const s = db.get<any>("SELECT * FROM index_state WHERE storage_id = ?", storageId);
  // Counters come from the crawl itself: COUNT(*) over a large index on every storage listing would be wasteful.
  const count = (s?.files_indexed ?? 0) + (s?.folders_scanned ?? 0);
  return { status: (running.has(storageId) || queue.includes(storageId) ? "RUNNING" : s?.status ?? "IDLE") as any, filesIndexed: s?.files_indexed ?? 0, foldersScanned: s?.folders_scanned ?? 0, startedAt: s?.started_at ?? null, finishedAt: s?.finished_at ?? null, count, error: s?.error ?? null };
}

/** Index storages that were never crawled or whose crawl is older than `maxAgeH`. Called at boot and periodically. */
export function scheduleStale(maxAgeH = 12) {
  const cutoff = new Date(Date.now() - maxAgeH * 3600_000).toISOString();
  for (const s of db.all<{ id: string; finished_at: string | null; status: string | null }>(
    `SELECT s.id, i.finished_at, i.status FROM storages s LEFT JOIN index_state i ON i.storage_id = s.id WHERE s.status = 'CONNECTED'`)) {
    if (!s.finished_at || s.finished_at < cutoff || s.status === "RUNNING") scheduleIndex(s.id);
  }
}
