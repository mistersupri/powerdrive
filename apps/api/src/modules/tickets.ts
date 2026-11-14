import { randomToken } from "../lib/crypto.ts";

/**
 * Short-lived download tickets. A multi-item ZIP is requested with a POST (the ids can be many), which a browser form
 * handles but an Android WebView / download manager cannot; so the POST returns a ticket and the ZIP itself is a plain GET.
 * A ticket is bound to who asked (a user, or one share) and expires after three minutes.
 */
interface Ticket { owner: string; ids: string[]; storageId?: string; expires: number }
const tickets = new Map<string, Ticket>();

export function issueTicket(owner: string, ids: string[], storageId?: string): string {
  const now = Date.now(); for (const [k, v] of tickets) if (v.expires < now) tickets.delete(k);
  if (tickets.size > 5000) tickets.clear();
  const t = randomToken(24); tickets.set(t, { owner, ids, storageId, expires: now + 3 * 60_000 }); return t;
}
export function readTicket(token: string, owner: string): Ticket | null {
  const t = tickets.get(token); return t && t.expires > Date.now() && t.owner === owner ? t : null;
}
