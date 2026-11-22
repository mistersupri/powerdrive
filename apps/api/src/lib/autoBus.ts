import { EventEmitter } from "node:events";

/** Things the automations listen for. Raised from where they happen; handled a moment later so they never slow the request down. */
export interface AutoEvent {
  type: "file.created" | "transfer.failed" | "transfer.completed" | "share.opened" | "upload.failed";
  storageId?: string; workspaceId?: string; fileId?: string;
  /** Where a new file came from. "edit" (rename, trash, restore) never counts as a new file. */
  source?: "upload" | "transfer" | "scan" | "edit";
  /** True when an automation itself caused it: such files never start another automation (no loops). */
  byAutomation?: boolean;
  data?: Record<string, unknown>;
}
export const autoBus = new EventEmitter();
autoBus.setMaxListeners(0);
export const emitAuto = (e: AutoEvent) => { setImmediate(() => { try { autoBus.emit("event", e); } catch { /* a listener must never break the caller */ } }); };
