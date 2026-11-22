import crypto from "node:crypto";
import { z } from "zod";
import type { AutomationAction, AutomationConditions, AutomationDto, AutomationRunDto, AutomationTrigger } from "@superdrive/shared";
import { db, now } from "../db.ts";
import { autoBus, type AutoEvent } from "../lib/autoBus.ts";
import { audit, notify } from "../lib/audit.ts";
import { newId } from "../lib/crypto.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { assertSafeEndpoint } from "../lib/ssrf.ts";
import { TRASH } from "../providers/pathutil.ts";
import { decodeId, encodeId, ROOT } from "../providers/types.ts";
import { addTag } from "./activity.ts";
import { notPrivateSql } from "./albums.ts";
import { indexPath, setStar, TYPE_FILTERS } from "./files.ts";
import { can, requireStorage, type AuthCtx } from "./permissions.ts";
import { providerFor } from "./storages.ts";
import { trashFiles } from "./trash.ts";
import { createTransfer } from "./transfers.ts";

/**
 * Automations: "when X happens (or at this time), for files that look like Y, do Z".
 * One model covers event rules, scheduled copies, clean-up of old files and webhooks. An automation can do only what its creator
 * could do by hand, and that is checked again every time it runs, so losing a permission (or leaving the workspace) stops it.
 */

const MAX_PER_WORKSPACE = 100; const MAX_PER_RUN = 500; const MAX_FAILURES = 5; const MASK = "••••••••";

/* ---------------- input ---------------- */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Jam harus berformat HH:MM.");
const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file.created") }),
  z.object({ type: z.literal("schedule"), every: z.enum(["minutes", "hourly", "daily", "weekly"]), n: z.number().int().min(5).max(1440).optional(), at: hhmm.optional(), weekday: z.number().int().min(0).max(6).optional() }),
  z.object({ type: z.literal("event"), event: z.enum(["transfer.failed", "transfer.completed", "share.opened", "upload.failed"]) }),
]);
const conditionsSchema = z.object({
  name: z.string().trim().max(120).optional(), ext: z.array(z.string().trim().toLowerCase().max(12)).max(20).optional(),
  kinds: z.array(z.enum(["image", "video", "audio", "pdf", "document", "archive"])).max(6).optional(),
  minSize: z.number().int().min(0).optional(), maxSize: z.number().int().min(0).optional(), olderThanDays: z.number().int().min(0).max(36500).optional(),
});
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), storageId: z.string().min(1), folderId: z.string().min(1), label: z.string().max(200).optional() }),
  z.object({ type: z.literal("copy"), storageId: z.string().min(1), folderId: z.string().min(1), label: z.string().max(200).optional(), mirror: z.boolean().optional() }),
  z.object({ type: z.literal("tag"), tag: z.string().trim().min(1).max(40) }),
  z.object({ type: z.literal("star") }), z.object({ type: z.literal("trash") }),
  z.object({ type: z.literal("notify"), message: z.string().trim().max(300).optional() }),
  z.object({ type: z.literal("webhook"), url: z.string().url().max(500), secret: z.string().max(100).optional() }),
]);
export const automationInput = z.object({
  name: z.string().trim().min(1).max(80), enabled: z.boolean().default(true),
  storageId: z.string().nullable().optional(), folderId: z.string().nullable().optional(), recursive: z.boolean().default(true),
  trigger: triggerSchema, conditions: conditionsSchema.default({}), actions: z.array(actionSchema).min(1).max(5),
});
export type AutomationInput = z.infer<typeof automationInput>;

/** Rules that do not depend on permissions: which combinations make sense. */
function checkShape(i: AutomationInput) {
  const event = i.trigger.type === "event"; const acts = i.actions;
  if (!event && !i.storageId) throw badRequest("Pilih penyimpanan untuk otomasi ini.");
  if (event && acts.some((a) => a.type !== "notify" && a.type !== "webhook")) throw badRequest("Pemicu kejadian hanya bisa mengirim notifikasi atau webhook.");
  const last = acts.length - 1;
  acts.forEach((a, k) => { if ((a.type === "move" || a.type === "trash") && k !== last) throw badRequest("Aksi memindahkan atau menghapus harus yang terakhir, karena file tidak lagi di tempat semula."); });
  if (acts.filter((a) => a.type === "move" || a.type === "trash").length > 1) throw badRequest("Pilih salah satu: memindahkan atau menghapus.");
  const mirror = acts.some((a) => a.type === "copy" && a.mirror);
  if (mirror && (i.trigger.type !== "schedule" || acts.length !== 1)) throw badRequest("Sinkronisasi hanya untuk jadwal, dan berdiri sendiri tanpa aksi lain.");
  if (i.trigger.type === "schedule" && i.trigger.every === "minutes" && !i.trigger.n) throw badRequest("Isi selang menit untuk jadwal ini.");
}

async function folderOk(ctx: AuthCtx, storageId: string, folderId: string | null | undefined) {
  if (!folderId || folderId === ROOT) return;
  const row = requireStorage(ctx, storageId, "READ");
  const f = await providerFor(row).stat(decodeId(folderId)).catch(() => { throw notFound("Folder tidak ditemukan."); });
  if (!f.isFolder) throw badRequest("Tujuan harus berupa folder.");
}

/** What this person may put in an automation: only what they could do by hand. Checked when saving and again at every run. */
export async function assertAllowed(ctx: AuthCtx, i: AutomationInput) {
  const admin = ctx.role === "OWNER" || ctx.role === "ADMIN";
  if (i.trigger.type === "event" && !admin) throw forbidden("Hanya admin yang bisa membuat otomasi berbasis kejadian.");
  if (i.actions.some((a) => a.type === "webhook") && !admin) throw forbidden("Hanya admin yang bisa mengirim webhook.");
  if (i.storageId) { requireStorage(ctx, i.storageId, "READ"); await folderOk(ctx, i.storageId, i.folderId); }
  for (const a of i.actions) {
    if (a.type === "trash" && !can(ctx, i.storageId!, "DELETE")) throw forbidden("Anda tidak punya izin menghapus di penyimpanan ini.");
    if (a.type === "move") { if (!can(ctx, i.storageId!, "MOVE")) throw forbidden("Anda tidak punya izin memindahkan di penyimpanan ini."); requireStorage(ctx, a.storageId, "UPLOAD"); await folderOk(ctx, a.storageId, a.folderId); }
    if (a.type === "copy") { if (!can(ctx, i.storageId!, "COPY")) throw forbidden("Anda tidak punya izin menyalin dari penyimpanan ini."); requireStorage(ctx, a.storageId, "UPLOAD"); await folderOk(ctx, a.storageId, a.folderId); }
    if (a.type === "webhook") await assertSafeEndpoint(a.url);
  }
}

/* ---------------- schedule ---------------- */

export function nextRun(t: AutomationTrigger, from = new Date()): Date | null {
  if (t.type !== "schedule") return null;
  const d = new Date(from.getTime());
  if (t.every === "minutes") return new Date(d.getTime() + (t.n ?? 15) * 60_000);
  if (t.every === "hourly") { d.setUTCMinutes(0, 0, 0); d.setUTCHours(d.getUTCHours() + 1); return d; }
  const [h, m] = (t.at ?? "02:00").split(":").map(Number) as [number, number];
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m));
  if (t.every === "daily") { if (c <= d) c.setUTCDate(c.getUTCDate() + 1); return c; }
  c.setUTCDate(c.getUTCDate() + ((t.weekday ?? 0) - c.getUTCDay() + 7) % 7); if (c <= d) c.setUTCDate(c.getUTCDate() + 7);
  return c;
}

/* ---------------- finding the files ---------------- */

function conditionSql(c: AutomationConditions): { sql: string; args: (string | number)[] } {
  const w: string[] = []; const args: (string | number)[] = [];
  if (c.name?.trim()) { w.push("f.name_lower LIKE ? ESCAPE '\\'"); args.push(`%${c.name.trim().toLowerCase().replace(/[\\%_]/g, "\\$&")}%`); }
  if (c.ext?.length) { const e = c.ext.map((x) => x.replace(/^\./, "")).filter(Boolean); if (e.length) { w.push(`f.ext IN (${e.map(() => "?").join(",")})`); args.push(...e); } }
  if (c.kinds?.length) { const k = c.kinds.map((x) => TYPE_FILTERS[x]).filter(Boolean); if (k.length) w.push(`(${k.join(" OR ")})`); }
  if (c.minSize !== undefined) { w.push("f.size >= ?"); args.push(c.minSize); }
  if (c.maxSize !== undefined) { w.push("f.size <= ?"); args.push(c.maxSize); }
  if (c.olderThanDays !== undefined) { w.push("f.modified_at < ?"); args.push(new Date(Date.now() - c.olderThanDays * 86_400_000).toISOString()); }
  return { sql: w.length ? w.join(" AND ") : "1=1", args };
}

interface FileRow { storage_id: string; file_id: string; parent_id: string | null; name: string; size: number | null; mime_type: string | null; version: string | null; modified_at: string | null }

/** Files in the automation's folder (and below it, if asked) that match its conditions and have not been handled yet. */
function candidates(a: any, ctx: AuthCtx, only?: string[]): FileRow[] {
  const cond = conditionSql(JSON.parse(a.conditions)); const hide = notPrivateSql(ctx);
  const where: string[] = ["f.storage_id = ?", "f.is_folder = 0", cond.sql, hide.sql]; const args: (string | number)[] = [a.storage_id, ...cond.args, ...hide.args];
  if (only) { where.push(`f.file_id IN (${only.map(() => "?").join(",")})`); args.push(...only); }
  else {
    const root = !a.folder_id || a.folder_id === ROOT;
    if (!root && a.recursive) { where.push("f.parent_id IN (WITH RECURSIVE sub(id) AS (SELECT ? UNION SELECT c.file_id FROM files c JOIN sub ON c.parent_id = sub.id WHERE c.is_folder = 1 AND c.storage_id = ?) SELECT id FROM sub)"); args.push(a.folder_id, a.storage_id); }
    else if (!root) { where.push("f.parent_id = ?"); args.push(a.folder_id); }
    else if (!a.recursive) where.push("f.parent_id = 'root'");
    where.push("NOT EXISTS (SELECT 1 FROM automation_done d WHERE d.automation_id = ? AND d.storage_id = f.storage_id AND d.file_id = f.file_id)"); args.push(a.id);
  }
  // Never touch what is in the trash.
  where.push("f.parent_id NOT IN (WITH RECURSIVE tr(id) AS (SELECT file_id FROM files WHERE storage_id = ? AND is_folder = 1 AND name = ? UNION SELECT c.file_id FROM files c JOIN tr ON c.parent_id = tr.id WHERE c.storage_id = ? AND c.is_folder = 1) SELECT id FROM tr)");
  args.push(a.storage_id, TRASH, a.storage_id);
  return db.all<FileRow>(`SELECT f.* FROM files f WHERE ${where.join(" AND ")} ORDER BY f.modified_at LIMIT ?`, ...args, MAX_PER_RUN);
}

/** Is a new file inside the folder this automation watches? */
function inScope(a: any, storageId: string, fileId: string): boolean {
  const row = db.get<{ parent_id: string | null }>("SELECT parent_id FROM files WHERE storage_id = ? AND file_id = ?", storageId, fileId); if (!row) return false;
  const root = !a.folder_id || a.folder_id === ROOT;
  if (!root && !a.recursive) return row.parent_id === a.folder_id;
  let cur = row.parent_id; let hit = root;
  for (let i = 0; cur && cur !== ROOT && i < 64; i++) {
    if (cur === a.folder_id) hit = true;
    const p = db.get<{ name: string; parent_id: string | null }>("SELECT name, parent_id FROM files WHERE storage_id = ? AND file_id = ?", storageId, cur);
    if (!p) break; if (p.name === TRASH) return false; cur = p.parent_id;
  }
  return hit && (root ? a.recursive || row.parent_id === ROOT : true);
}

/* ---------------- doing things ---------------- */

const fill = (t: string, f: FileRow | null, a: any, extra: Record<string, unknown> = {}) =>
  t.replace(/\{(\w+)\}/g, (_m, k) => String(({ name: f?.name ?? "", path: f ? `${indexPath(f.storage_id, f.parent_id)}/${f.name}`.replace(/\/{2,}/g, "/") : "", size: f?.size ?? "", automation: a.name, ...extra } as Record<string, unknown>)[k] ?? ""));

async function webhook(a: any, act: Extract<AutomationAction, { type: "webhook" }>, payload: Record<string, unknown>) {
  await assertSafeEndpoint(act.url);
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "SuperDrive-Automation", "x-superdrive-event": String(payload.event) };
  if (act.secret) headers["x-superdrive-signature"] = `sha256=${crypto.createHmac("sha256", act.secret).update(body).digest("hex")}`;
  const res = await fetch(act.url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(8000) });
  if (res.status >= 300) throw new Error(`Webhook membalas HTTP ${res.status}.`);
}

async function perform(ctx: AuthCtx, a: any, act: AutomationAction, f: FileRow | null, ev: AutoEvent | null) {
  const wsId = a.workspace_id as string;
  switch (act.type) {
    case "tag": addTag(ctx, f!.storage_id, f!.file_id, fill(act.tag, f, a)); return;
    case "star": setStar(ctx.userId, f!.storage_id, f!.file_id, true); return;
    case "trash": { if (!can(ctx, f!.storage_id, "DELETE")) throw forbidden("Izin menghapus sudah tidak ada."); await trashFiles(ctx, f!.storage_id, providerFor(requireStorage(ctx, f!.storage_id, "READ")), [f!.file_id]); return; }
    case "move": case "copy":
      await createTransfer(ctx, { type: act.type === "move" ? "MOVE" : "COPY", source: { storageId: f!.storage_id, fileIds: [encodeId(f!.file_id)] }, destination: { storageId: act.storageId, folderId: act.folderId }, conflictPolicy: "RENAME", idempotencyKey: `auto:${a.id}:${f!.storage_id}:${f!.file_id}:${f!.version ?? ""}` });
      return;
    case "notify": notify(wsId, ctx.userId, "automation", `Otomasi “${a.name}”`, act.message ? fill(act.message, f, a, ev?.data ?? {}) : f ? `“${f.name}” diproses.` : `Kejadian ${ev?.type ?? ""}`.trim(), { automationId: a.id }); return;
    case "webhook": await webhook(a, act, { event: ev?.type ?? "automation.run", automation: { id: a.id, name: a.name }, at: now(), file: f ? { storageId: f.storage_id, id: encodeId(f.file_id), name: f.name, size: f.size, path: fill("{path}", f, a) } : undefined, data: ev?.data });
  }
}

const dtoOf = (a: any): { trigger: AutomationTrigger; conditions: AutomationConditions; actions: AutomationAction[] } => ({ trigger: JSON.parse(a.trigger), conditions: JSON.parse(a.conditions), actions: JSON.parse(a.actions) });

function ctxFor(a: any): AuthCtx | null {
  const m = db.get<{ role: string; name: string }>("SELECT m.role, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.user_id = ?", a.workspace_id, a.created_by);
  return m ? { userId: a.created_by, userName: m.name, isSuperAdmin: false, workspaceId: a.workspace_id, role: m.role as AuthCtx["role"], ip: "automation" } : null;
}

const asInput = (a: any): AutomationInput => ({ name: a.name, enabled: !!a.enabled, storageId: a.storage_id, folderId: a.folder_id, recursive: !!a.recursive, ...dtoOf(a) });

/** Runs one automation. `fileIds` limits it to those files (an event); a dry run only counts and names what it would touch. */
async function execute(a: any, how: "event" | "schedule" | "manual", o: { fileIds?: string[]; dryRun?: boolean; ev?: AutoEvent } = {}): Promise<AutomationRunDto> {
  const runId = newId(); const started = now(); const dry = !!o.dryRun;
  db.run("INSERT INTO automation_runs(id, automation_id, started_at, status, trigger, dry_run) VALUES (?,?,?,?,?,?)", runId, a.id, started, "RUNNING", how, dry ? 1 : 0);
  let status: AutomationRunDto["status"] = "OK"; let matched = 0; let acted = 0; let message: string | null = null; const errors: string[] = [];
  const finish = () => {
    const finished = now();
    db.run("UPDATE automation_runs SET finished_at = ?, status = ?, matched = ?, acted = ?, message = ? WHERE id = ?", finished, status, matched, acted, message, runId);
    if (!dry) {
      const bad = status === "FAILED" || status === "DENIED";
      const fails = bad ? a.failures + 1 : 0; const stop = status === "DENIED" || fails >= MAX_FAILURES;
      const nxt = nextRun(JSON.parse(a.trigger), new Date());
      db.run("UPDATE automations SET last_run_at = ?, last_status = ?, last_message = ?, failures = ?, enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?", finished, status, message, fails, stop ? 0 : a.enabled, nxt && !stop ? nxt.toISOString() : a.next_run_at, finished, a.id);
      if (stop) notify(a.workspace_id, a.created_by, "automation.disabled", `Otomasi “${a.name}” dimatikan`, message ?? "Gagal berulang kali.", { automationId: a.id });
    }
    return { id: runId, startedAt: started, finishedAt: finished, status, trigger: how, matched, acted, message, dryRun: dry } satisfies AutomationRunDto;
  };

  const ctx = ctxFor(a);
  if (!ctx) { status = "DENIED"; message = "Pembuat otomasi bukan lagi anggota workspace."; return finish(); }
  try { await assertAllowed(ctx, asInput(a)); } catch (e) { status = "DENIED"; message = `Izin tidak cukup lagi: ${(e as Error).message}`; return finish(); }

  const { trigger, actions } = dtoOf(a);
  try {
    // A scheduled copy that mirrors a folder is one transfer job: the engine skips what is already at the destination.
    const mirror = actions.find((x): x is Extract<AutomationAction, { type: "copy" }> => x.type === "copy" && !!x.mirror);
    if (mirror) {
      const root = !a.folder_id || a.folder_id === ROOT;
      const kids = db.all<{ file_id: string }>("SELECT file_id FROM files WHERE storage_id = ? AND parent_id = ? AND name <> ? LIMIT ?", a.storage_id, root ? ROOT : a.folder_id, TRASH, MAX_PER_RUN);
      matched = kids.length;
      const busy = db.get("SELECT 1 FROM transfer_jobs WHERE idempotency_key LIKE ? AND status IN ('QUEUED','VALIDATING','RUNNING','RETRYING','VERIFYING','PAUSED')", `auto:${a.id}:mirror:%`);
      if (busy) { status = "SKIPPED"; message = "Sinkronisasi sebelumnya masih berjalan."; return finish(); }
      if (!kids.length) { message = "Tidak ada isi untuk disalin."; return finish(); }
      if (dry) { message = `${kids.length} item di folder akan dicek dan disalin bila belum ada.`; return finish(); }
      await createTransfer(ctx, { type: "COPY", source: { storageId: a.storage_id, fileIds: kids.map((k) => encodeId(k.file_id)) }, destination: { storageId: mirror.storageId, folderId: mirror.folderId }, conflictPolicy: "SKIP", idempotencyKey: `auto:${a.id}:mirror:${Date.now()}` });
      acted = kids.length; message = `Penyalinan dimulai (${kids.length} item). Progres ada di halaman Transfer.`; return finish();
    }

    if (trigger.type === "event") {
      matched = 1; if (dry) { message = "Akan mengirim pemberitahuan setiap kali kejadian ini terjadi."; return finish(); }
      for (const act of actions) { try { await perform(ctx, a, act, null, o.ev ?? null); } catch (e) { errors.push((e as Error).message); } }
      acted = errors.length ? 0 : 1;
    } else {
      const rows = candidates(a, ctx, o.fileIds); matched = rows.length;
      if (dry) { message = rows.length ? `${rows.length} file cocok, mis. ${rows.slice(0, 3).map((r) => r.name).join(", ")}${rows.length > 3 ? ", …" : ""}` : "Tidak ada file yang cocok."; return finish(); }
      let consecutive = 0;
      for (const f of rows) {
        try {
          for (const act of actions) await perform(ctx, a, act, f, o.ev ?? null);
          db.run("INSERT OR REPLACE INTO automation_done(automation_id, storage_id, file_id, done_at) VALUES (?,?,?,?)", a.id, f.storage_id, f.file_id, now()); acted++; consecutive = 0;
        } catch (e) { errors.push(`${f.name}: ${(e as Error).message}`); if (++consecutive >= 10) { errors.push("Berhenti setelah 10 kegagalan beruntun."); break; } }
      }
    }
    if (errors.length) { status = acted > 0 ? "PARTIAL" : "FAILED"; message = errors.slice(0, 3).join(" · ") + (errors.length > 3 ? ` · +${errors.length - 3} lagi` : ""); }
    else message = matched ? `${acted} dari ${matched} diproses.` : "Tidak ada yang cocok.";
  } catch (e) { status = "FAILED"; message = (e as Error).message; }
  return finish();
}

/* ---------------- running them ---------------- */

// One at a time, so a burst of uploads cannot start a burst of copies.
let chain: Promise<unknown> = Promise.resolve();
const enqueue = <T>(fn: () => Promise<T>): Promise<T> => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };

async function onEvent(e: AutoEvent) {
  const st = e.storageId ? db.get<{ workspace_id: string }>("SELECT workspace_id FROM storages WHERE id = ?", e.storageId) : undefined;
  const ws = e.workspaceId ?? st?.workspace_id; if (!ws) return;
  for (const a of db.all<any>("SELECT * FROM automations WHERE enabled = 1 AND workspace_id = ?", ws)) {
    const t = JSON.parse(a.trigger) as AutomationTrigger;
    if (e.type === "file.created") {
      if (t.type !== "file.created" || e.byAutomation || !e.fileId || !e.storageId || a.storage_id !== e.storageId || !inScope(a, e.storageId, e.fileId)) continue;
      // A crawl also finds old files: only what is newer than the automation counts. Uploads and transfers always count.
      if (e.source === "scan") { const m = db.get<{ modified_at: string | null }>("SELECT modified_at FROM files WHERE storage_id = ? AND file_id = ?", e.storageId, e.fileId); if (m?.modified_at && m.modified_at < new Date(Date.parse(a.created_at) - 5 * 60_000).toISOString()) continue; }
      void enqueue(() => execute(a, "event", { fileIds: [e.fileId!], ev: e }));
    } else if (t.type === "event" && t.event === e.type && (!a.storage_id || !e.storageId || a.storage_id === e.storageId)) void enqueue(() => execute(a, "event", { ev: e }));
  }
}
autoBus.on("event", (e: AutoEvent) => { void onEvent(e).catch(() => {}); });

/** Called every minute by the scheduler. */
export async function runDueAutomations() {
  for (const a of db.all<any>("SELECT * FROM automations WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?", now())) {
    // Move the next time on first, so a slow run is never started twice.
    const nxt = nextRun(JSON.parse(a.trigger)); db.run("UPDATE automations SET next_run_at = ? WHERE id = ?", nxt?.toISOString() ?? null, a.id);
    void enqueue(() => execute(a, "schedule"));
  }
}

/* ---------------- the API's view ---------------- */

const redact = (acts: AutomationAction[]): AutomationAction[] => acts.map((x) => (x.type === "webhook" && x.secret ? { ...x, secret: MASK } : x));
function toDto(a: any, ctx: AuthCtx): AutomationDto {
  const st = a.storage_id ? db.get<{ name: string }>("SELECT name FROM storages WHERE id = ?", a.storage_id) : undefined;
  const u = db.get<{ name: string }>("SELECT name FROM users WHERE id = ?", a.created_by); const d = dtoOf(a);
  return {
    id: a.id, name: a.name, enabled: !!a.enabled, createdBy: a.created_by, createdByName: u?.name ?? "—", storageId: a.storage_id, storageName: st?.name ?? null,
    folderId: a.folder_id && a.folder_id !== ROOT ? encodeId(a.folder_id) : null, folderPath: a.storage_id ? indexPath(a.storage_id, a.folder_id ?? ROOT) : null, recursive: !!a.recursive,
    trigger: d.trigger, conditions: d.conditions, actions: redact(d.actions), nextRunAt: a.next_run_at, lastRunAt: a.last_run_at, lastStatus: a.last_status, lastMessage: a.last_message, failures: a.failures,
    canEdit: a.created_by === ctx.userId || ctx.role === "OWNER" || ctx.role === "ADMIN",
  };
}

const mine = (ctx: AuthCtx, id: string) => {
  const a = db.get<any>("SELECT * FROM automations WHERE id = ? AND workspace_id = ?", id, ctx.workspaceId); if (!a) throw notFound("Otomasi tidak ditemukan.");
  if (a.created_by !== ctx.userId && ctx.role !== "OWNER" && ctx.role !== "ADMIN") throw forbidden("Otomasi ini dibuat anggota lain.");
  return a;
};

export function listAutomations(ctx: AuthCtx): AutomationDto[] {
  const admin = ctx.role === "OWNER" || ctx.role === "ADMIN";
  return db.all<any>(`SELECT * FROM automations WHERE workspace_id = ? ${admin ? "" : "AND created_by = ?"} ORDER BY created_at DESC`, ...(admin ? [ctx.workspaceId] : [ctx.workspaceId, ctx.userId])).map((a) => toDto(a, ctx));
}

export async function createAutomation(ctx: AuthCtx, i: AutomationInput): Promise<AutomationDto> {
  if (ctx.role === "VIEWER") throw forbidden("Pembaca tidak bisa membuat otomasi.");
  checkShape(i); await assertAllowed(ctx, i);
  if (db.get<{ n: number }>("SELECT COUNT(*) n FROM automations WHERE workspace_id = ?", ctx.workspaceId)!.n >= MAX_PER_WORKSPACE) throw badRequest(`Batas ${MAX_PER_WORKSPACE} otomasi per workspace tercapai.`);
  const id = newId(); const nxt = nextRun(i.trigger);
  db.run("INSERT INTO automations(id, workspace_id, created_by, name, enabled, storage_id, folder_id, recursive, trigger, conditions, actions, next_run_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    id, ctx.workspaceId, ctx.userId, i.name, i.enabled ? 1 : 0, i.storageId ?? null, i.folderId ? decodeId(i.folderId) : null, i.recursive ? 1 : 0, JSON.stringify(i.trigger), JSON.stringify(i.conditions), JSON.stringify(i.actions), nxt?.toISOString() ?? null);
  audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "automation.create", resourceType: "automation", resourceId: id, metadata: { name: i.name, trigger: i.trigger.type }, ip: ctx.ip });
  return toDto(db.get<any>("SELECT * FROM automations WHERE id = ?", id), ctx);
}

export async function updateAutomation(ctx: AuthCtx, id: string, i: AutomationInput): Promise<AutomationDto> {
  const a = mine(ctx, id); const old = dtoOf(a).actions;
  // A masked webhook secret means "keep the one already saved".
  const kept = (k: number) => { const same = old[k]; const hook = same?.type === "webhook" ? same : (old.find((o) => o.type === "webhook") as Extract<AutomationAction, { type: "webhook" }> | undefined); return hook?.secret; };
  const actions = i.actions.map((x, k) => (x.type === "webhook" && x.secret === MASK ? { ...x, secret: kept(k) } : x));
  const next = { ...i, actions }; checkShape(next); await assertAllowed(ctx, next);
  const nxt = nextRun(next.trigger);
  db.run("UPDATE automations SET name = ?, enabled = ?, storage_id = ?, folder_id = ?, recursive = ?, trigger = ?, conditions = ?, actions = ?, next_run_at = ?, failures = 0, updated_at = ? WHERE id = ?",
    next.name, next.enabled ? 1 : 0, next.storageId ?? null, next.folderId ? decodeId(next.folderId) : null, next.recursive ? 1 : 0, JSON.stringify(next.trigger), JSON.stringify(next.conditions), JSON.stringify(next.actions), nxt?.toISOString() ?? null, now(), id);
  return toDto(db.get<any>("SELECT * FROM automations WHERE id = ?", id), ctx);
}

export async function setAutomationEnabled(ctx: AuthCtx, id: string, enabled: boolean): Promise<AutomationDto> {
  const a = mine(ctx, id);
  if (enabled) { const c = ctxFor(a); if (!c) throw forbidden("Pembuat otomasi bukan lagi anggota."); await assertAllowed(c, asInput(a)); }
  db.run("UPDATE automations SET enabled = ?, failures = 0, next_run_at = ?, updated_at = ? WHERE id = ?", enabled ? 1 : 0, enabled ? nextRun(JSON.parse(a.trigger))?.toISOString() ?? null : a.next_run_at, now(), id);
  return toDto(db.get<any>("SELECT * FROM automations WHERE id = ?", id), ctx);
}

export function deleteAutomation(ctx: AuthCtx, id: string) {
  const a = mine(ctx, id); db.run("DELETE FROM automation_done WHERE automation_id = ?", id); db.run("DELETE FROM automations WHERE id = ?", id);
  audit({ workspaceId: ctx.workspaceId, userId: ctx.userId, action: "automation.delete", resourceType: "automation", resourceId: id, metadata: { name: a.name }, ip: ctx.ip });
}

/** "Run now": on what is already there, or just a preview of what it would do. */
export async function runAutomationNow(ctx: AuthCtx, id: string, dryRun: boolean): Promise<AutomationRunDto> {
  const a = mine(ctx, id);
  if (dryRun) return execute(a, "manual", { dryRun: true });
  return enqueue(() => execute(a, "manual"));
}

export function automationRuns(ctx: AuthCtx, id: string): AutomationRunDto[] {
  mine(ctx, id);
  return db.all<any>("SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT 30", id).map((r) => ({ id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, trigger: r.trigger, matched: r.matched, acted: r.acted, message: r.message, dryRun: !!r.dry_run }));
}

/** Old run records go after 60 days. */
export function pruneAutomationRuns() { db.run("DELETE FROM automation_runs WHERE started_at < ?", new Date(Date.now() - 60 * 86_400_000).toISOString()); }

