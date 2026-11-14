import { db } from "../db.ts";
import { getSettings } from "./settings.ts";

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

/** Delete what the retention settings say is old enough. 0 days means "keep". Returns what was removed, for the admin screen and the log. */
export function sweepRetention() {
  const r = getSettings().retention; const out = { audit: 0, activity: 0, transfers: 0, notifications: 0 };
  if (r.auditDays > 0) {
    out.audit = Number(db.run("DELETE FROM audit_logs WHERE created_at < ?", daysAgo(r.auditDays)).changes);
    out.activity = Number(db.run("DELETE FROM file_activity WHERE created_at < ?", daysAgo(r.auditDays)).changes);
  }
  if (r.transferHistoryDays > 0) {
    // Only finished jobs; their items go with them (ON DELETE CASCADE).
    out.transfers = Number(db.run("DELETE FROM transfer_jobs WHERE status IN ('COMPLETED','FAILED','CANCELLED','COPY_COMPLETED_SOURCE_RETAINED') AND COALESCE(completed_at, updated_at, created_at) < ?", daysAgo(r.transferHistoryDays)).changes);
  }
  out.notifications = Number(db.run("DELETE FROM notifications WHERE created_at < ?", daysAgo(90)).changes);
  return out;
}
