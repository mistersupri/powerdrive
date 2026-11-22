import { Readable } from "node:stream";
import bigInt from "big-integer";
import { Api, TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
import { StringSession } from "telegram/sessions/index.js";
import { ProviderError } from "./types.ts";
import type { TelegramApi, TgMessage } from "./telegram.ts";

/** What is kept (encrypted) for a connected Telegram account. */
export interface TelegramCredential { apiId: number; apiHash: string; session: string }
/** Where the files live: a private channel made for this storage, or the account's own Saved Messages. */
export interface TelegramConfig { chat: "saved" | "channel"; channelId?: string; accessHash?: string; title?: string; /** The Telegram account that owns this storage, so a later sign-in cannot be a different one. */ userId?: string }

/** Telegram asks for download requests aligned to 4 KB and no larger than 1 MB; 512 KB keeps every request valid. */
export const DOWNLOAD_REQUEST = 512 * 1024;

export function mapTelegramError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const msg = String((e as any)?.errorMessage ?? (e as Error)?.message ?? e);
  if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|AUTH_KEY_DUPLICATED|AUTH_KEY_INVALID/.test(msg)) return new ProviderError("Sesi Telegram berakhir. Hubungkan ulang penyimpanan ini.", "auth", 401);
  if (/FLOOD_WAIT|FLOOD_PREMIUM_WAIT|SLOWMODE_WAIT/.test(msg)) return new ProviderError("Telegram membatasi kecepatan permintaan. Coba lagi sebentar lagi.", "rate", 429);
  if (/CHANNEL_PRIVATE|CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED|CHANNEL_INVALID|PEER_ID_INVALID/.test(msg)) return new ProviderError("Akun ini tidak punya akses ke channel penyimpanan.", "other");
  if (/ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|TIMEOUT|Not connected|Connection closed|CONNECTION/i.test(msg)) return new ProviderError("Tidak dapat terhubung ke Telegram.", "network");
  return new ProviderError(`Kesalahan Telegram: ${msg}`, "other");
}

const view = (m: Api.Message): TgMessage => {
  const doc = m.media instanceof Api.MessageMediaDocument && m.media.document instanceof Api.Document ? m.media.document : null;
  return { id: m.id, text: m.message ?? "", date: m.date, doc: doc ? { size: doc.size.toJSNumber(), mime: doc.mimeType ?? null, hasThumb: !!doc.thumbs?.some((t) => t instanceof Api.PhotoSize) } : null };
};

/** The part of gramjs the adapter uses, so it can be replaced in tests. */
type Gram = Pick<TelegramClient, "connected" | "connect" | "disconnect" | "getMessages" | "sendMessage" | "sendFile" | "editMessage" | "deleteMessages" | "iterDownload" | "downloadMedia" | "getMe">;

/** Talks to Telegram over MTProto, as the signed-in account. */
export class GramjsApi implements TelegramApi {
  constructor(private client: Gram, private peer: Api.TypeEntityLike) {}

  static open(cred: TelegramCredential, cfg: TelegramConfig): GramjsApi {
    const client = new TelegramClient(new StringSession(cred.session), cred.apiId, cred.apiHash, { connectionRetries: 5, retryDelay: 1500, autoReconnect: true });
    client.setLogLevel("none" as never);
    const peer = cfg.chat === "saved" ? "me" : new Api.InputPeerChannel({ channelId: bigInt(cfg.channelId ?? "0"), accessHash: bigInt(cfg.accessHash ?? "0") });
    return new GramjsApi(client, peer);
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try { if (!this.client.connected) await this.client.connect(); return await fn(); } catch (e) { throw mapTelegramError(e); }
  }
  private async fresh(id: number): Promise<Api.Message> {
    // A document's download reference expires, so the message is fetched again just before its bytes are.
    const [m] = await this.client.getMessages(this.peer, { ids: [id] });
    if (!(m instanceof Api.Message)) throw new ProviderError("Pesan tidak ditemukan di Telegram.", "not_found");
    return m;
  }

  async me() {
    return this.guard(async () => {
      const u = (await this.client.getMe()) as Api.User;
      return { id: String(u.id), name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "Telegram", username: u.username ?? null };
    });
  }
  async after(minId: number, limit: number) {
    return this.guard(async () => {
      const list = await this.client.getMessages(this.peer, { limit, minId, reverse: true });
      return [...list].filter((m): m is Api.Message => m instanceof Api.Message).sort((a, b) => a.id - b.id).map(view);
    });
  }
  async sendText(text: string) { return this.guard(async () => view(await this.client.sendMessage(this.peer, { message: text }))); }
  async sendFile(file: { path: string; name: string; size: number; mime: string | null }, caption: string) {
    return this.guard(async () => view(await this.client.sendFile(this.peer, {
      file: new CustomFile(file.name, file.size, file.path), caption, forceDocument: true, workers: 4,
      attributes: [new Api.DocumentAttributeFilename({ fileName: file.name })],
    })));
  }
  async edit(id: number, text: string) { await this.guard(() => this.client.editMessage(this.peer, { message: id, text })); }
  async remove(ids: number[]) { await this.guard(() => this.client.deleteMessages(this.peer, ids, { revoke: true })); }

  download(id: number, start: number, endExclusive: number): AsyncIterable<Buffer> {
    const self = this;
    return (async function* () {
      let media: Api.TypeMessageMedia | undefined; let size = 0;
      await self.guard(async () => { const m = await self.fresh(id); media = m.media; size = view(m).doc?.size ?? 0; });
      if (!media) throw new ProviderError("File ini tidak punya isi di Telegram.", "not_found");
      // Requests must start on a block boundary: begin at the one at or before `start` and trim.
      const first = Math.floor(start / DOWNLOAD_REQUEST) * DOWNLOAD_REQUEST;
      let pos = first;
      const it = self.client.iterDownload({ file: media, offset: bigInt(first), requestSize: DOWNLOAD_REQUEST, fileSize: bigInt(size) });
      try {
        for await (const chunk of it) {
          const buf = Buffer.from(chunk as Uint8Array);
          const a = Math.max(start, pos) - pos; const b = Math.min(endExclusive, pos + buf.length) - pos;
          if (b > a) yield buf.subarray(a, b);
          pos += buf.length;
          if (pos >= endExclusive) break;
        }
      } catch (e) { throw mapTelegramError(e); }
    })();
  }

  async thumbnail(id: number): Promise<Buffer | null> {
    try {
      return await this.guard(async () => {
        const m = await this.fresh(id);
        const doc = m.media instanceof Api.MessageMediaDocument && m.media.document instanceof Api.Document ? m.media.document : null;
        const best = doc?.thumbs?.filter((t) => t instanceof Api.PhotoSize).pop();
        if (!best) return null;
        const out = await this.client.downloadMedia(m, { thumb: best });
        return Buffer.isBuffer(out) ? out : null;
      });
    } catch { return null; } // a missing picture is not worth an error
  }

  close() { void this.client.disconnect().catch(() => {}); }
}

/** One client per storage, kept for the life of the process (connections are slow to set up). */
const apis = new Map<string, GramjsApi>();
export function telegramApiFor(storageId: string, cred: TelegramCredential, cfg: TelegramConfig): GramjsApi {
  let a = apis.get(storageId); if (!a) { a = GramjsApi.open(cred, cfg); apis.set(storageId, a); } return a;
}
export function dropTelegramApi(storageId: string) { apis.get(storageId)?.close(); apis.delete(storageId); }

/* ---------------------------------------------------------------------------------------------- *
 * Signing in. Telegram asks, in turn, for a code sent to the account, and for the two-step password if it has one.
 * The sign-in is held in memory between requests (10 minutes at most); nothing is stored until a storage is created.
 * ---------------------------------------------------------------------------------------------- */

export type LoginState = "starting" | "code" | "password" | "ready" | "error";
interface Login {
  id: string; client: TelegramClient; apiId: number; apiHash: string; state: LoginState; error?: string; session?: string; user?: { id: string; name: string };
  giveCode?: (c: string) => void; givePassword?: (p: string) => void; wake: Array<() => void>; timer: NodeJS.Timeout;
}
const logins = new Map<string, Login>();
const LOGIN_TTL = 10 * 60_000;

const say = (msg: string): string =>
  /PHONE_NUMBER_INVALID|PHONE_NUMBER_BANNED/.test(msg) ? "Nomor telepon tidak valid."
  : /PHONE_CODE_INVALID|PHONE_CODE_EMPTY/.test(msg) ? "Kode salah."
  : /PHONE_CODE_EXPIRED/.test(msg) ? "Kode kedaluwarsa. Mulai lagi."
  : /PASSWORD_HASH_INVALID/.test(msg) ? "Sandi verifikasi dua langkah salah."
  : /API_ID_INVALID|API_ID_PUBLISHED_FLOOD/.test(msg) ? "API ID atau API hash tidak valid."
  : /FLOOD/.test(msg) ? "Terlalu sering mencoba. Tunggu beberapa saat lalu coba lagi."
  : /SIGNUP_NOT_ALLOWED/.test(msg) ? "Nomor ini belum punya akun Telegram. Daftar dulu lewat aplikasi Telegram."
  : `Gagal masuk: ${msg}`;

const fire = (l: Login) => { const w = l.wake.splice(0); w.forEach((f) => f()); };
/** Waits until the sign-in moves on (or a minute passes), then reports where it is. */
const settle = async (l: Login) => {
  await Promise.race([new Promise<void>((r) => l.wake.push(r)), new Promise<void>((r) => setTimeout(r, 60_000))]);
  return { loginId: l.id, state: l.state, error: l.error };
};

export function forgetLogin(id: string) { const l = logins.get(id); if (!l) return; clearTimeout(l.timer); logins.delete(id); void l.client.disconnect().catch(() => {}); }

export async function startLogin(id: string, apiId: number, apiHash: string, phone: string) {
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3 });
  client.setLogLevel("none" as never);
  const l: Login = { id, client, apiId, apiHash, state: "starting", wake: [], timer: setTimeout(() => forgetLogin(id), LOGIN_TTL) };
  logins.set(id, l);
  let asked = 0;
  void (async () => {
    try {
      await client.connect();
      await client.start({
        phoneNumber: async () => { if (asked++) throw new Error("PHONE_NUMBER_INVALID"); return phone; },
        phoneCode: () => new Promise<string>((res) => { l.giveCode = res; l.state = "code"; fire(l); }),
        password: () => new Promise<string>((res) => { l.givePassword = res; l.state = "password"; fire(l); }),
        // Never let a number without an account be registered as a new one.
        firstAndLastNames: async () => { throw new Error("SIGNUP_NOT_ALLOWED"); },
        onError: async (e) => {
          const msg = String((e as any)?.errorMessage ?? e?.message ?? e); l.error = say(msg);
          if (/SIGNUP_NOT_ALLOWED|PHONE_NUMBER_INVALID|API_ID_INVALID|FLOOD|PHONE_CODE_EXPIRED/.test(msg)) return true; // stop: asking again would not help
          fire(l); return false; // wrong code or password: ask again
        },
      });
      const me = (await client.getMe()) as Api.User;
      l.session = client.session.save() as unknown as string; l.user = { id: String(me.id), name: [me.firstName, me.lastName].filter(Boolean).join(" ") || me.username || "Telegram" };
      l.state = "ready"; l.error = undefined;
    } catch (e) { l.state = "error"; l.error = l.error ?? say(String((e as any)?.errorMessage ?? (e as Error)?.message ?? e)); }
    fire(l);
  })();
  return settle(l);
}

const get = (id: string) => { const l = logins.get(id); if (!l) throw new ProviderError("Sesi masuk Telegram sudah berakhir. Mulai lagi.", "other"); return l; };

export async function submitCode(id: string, code: string) {
  const l = get(id); if (l.state !== "code" || !l.giveCode) throw new ProviderError("Telegram sedang tidak meminta kode.", "other");
  l.error = undefined; const give = l.giveCode; l.giveCode = undefined; l.state = "starting"; give(code.trim()); return settle(l);
}
export async function submitPassword(id: string, password: string) {
  const l = get(id); if (l.state !== "password" || !l.givePassword) throw new ProviderError("Telegram sedang tidak meminta sandi.", "other");
  l.error = undefined; const give = l.givePassword; l.givePassword = undefined; l.state = "starting"; give(password); return settle(l);
}

/** A finished sign-in, with what is needed to keep the account connected. */
export function loginResult(id: string): { credential: TelegramCredential; user: { id: string; name: string } } {
  const l = get(id); if (l.state !== "ready" || !l.session || !l.user) throw new ProviderError("Masuk ke Telegram belum selesai.", "other");
  return { credential: { apiId: l.apiId, apiHash: l.apiHash, session: l.session }, user: l.user };
}

/** Makes the private channel that will hold the files. */
export async function createStorageChannel(id: string, title: string): Promise<{ channelId: string; accessHash: string }> {
  const l = get(id);
  try {
    const res = (await l.client.invoke(new Api.channels.CreateChannel({ title, about: "Penyimpanan SuperDrive. Jangan hapus atau ubah pesan di sini secara manual.", broadcast: true, megagroup: false }))) as Api.Updates;
    const ch = res.chats.find((c): c is Api.Channel => c instanceof Api.Channel);
    if (!ch?.accessHash) throw new Error("Channel tidak terbuat");
    return { channelId: ch.id.toString(), accessHash: ch.accessHash.toString() };
  } catch (e) { throw mapTelegramError(e); }
}

/** The calls the routes and the provider factory make, behind an object so tests can swap in a Telegram that needs no network. */
export const telegramLogin = { start: startLogin, code: submitCode, password: submitPassword, result: loginResult, channel: createStorageChannel, forget: forgetLogin };
export const telegramApis = { for: telegramApiFor, drop: dropTelegramApi };
