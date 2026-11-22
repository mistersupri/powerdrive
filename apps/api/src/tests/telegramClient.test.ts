import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import bigInt from "big-integer";
import { Api } from "telegram";
import { DOWNLOAD_REQUEST, GramjsApi, mapTelegramError } from "../providers/telegramClient.ts";
import { ProviderError } from "../providers/types.ts";

const doc = (size: number, mime = "application/octet-stream") => new Api.MessageMediaDocument({ document: new Api.Document({ id: bigInt(1), accessHash: bigInt(2), fileReference: Buffer.alloc(1), date: 1, mimeType: mime, size: bigInt(size), dcId: 1, attributes: [] }) });
const message = (id: number, text: string, media?: Api.MessageMediaDocument) => new Api.Message({ id, peerId: new Api.PeerChannel({ channelId: bigInt(5) }), date: 1_700_000_000 + id, message: text, media });

/** Just enough of gramjs: it hands out a file in the block-aligned requests Telegram insists on. */
function fakeGram(data: Buffer, msgs: unknown[] = []) {
  const seen: number[] = [];
  return { seen, client: {
    connected: true, async connect() {}, async disconnect() {},
    async getMessages(_p: unknown, o: { ids?: number[]; minId?: number; limit?: number }) {
      if (o.ids) return [message(o.ids[0]!, "SD1 {}", doc(data.length))];
      return (msgs as any[]).filter((m) => m.id > (o.minId ?? 0)).slice(0, o.limit);
    },
    iterDownload(o: { offset?: bigInt.BigInteger; requestSize: number }) {
      const start = o.offset!.toJSNumber(); assert.equal(start % 4096, 0, "Telegram rejects offsets that are not on a 4 KB boundary"); assert.equal(start % o.requestSize, 0);
      seen.push(start);
      return (async function* () { for (let p = start; p < data.length; p += o.requestSize) yield data.subarray(p, Math.min(data.length, p + o.requestSize)); })();
    },
  } as any };
}
const all = async (it: AsyncIterable<Buffer>) => { const c: Buffer[] = []; for await (const b of it) c.push(b); return Buffer.concat(c); };

describe("telegram client", () => {
  const data = crypto.randomBytes(2 * DOWNLOAD_REQUEST + 12_345);

  it("starts a ranged download on a block boundary and trims to exactly the bytes asked for", async () => {
    const g = fakeGram(data); const api = new GramjsApi(g.client, "me");
    assert.deepEqual(await all(api.download(1, 0, data.length)), data);
    assert.deepEqual(await all(api.download(1, 700_000, 1_100_000)), data.subarray(700_000, 1_100_000), "starts mid-block");
    assert.deepEqual(await all(api.download(1, data.length - 5, data.length)), data.subarray(data.length - 5));
    assert.deepEqual(await all(api.download(1, 10, 11)), data.subarray(10, 11));
    assert.ok(g.seen.every((o) => o % DOWNLOAD_REQUEST === 0), `offsets asked for: ${g.seen.join(",")}`);
    assert.equal(g.seen[1], DOWNLOAD_REQUEST, "700 000 bytes in lies in the second block");
  });

  it("stops asking Telegram for more once the range is complete", async () => {
    const g = fakeGram(Buffer.alloc(40 * DOWNLOAD_REQUEST)); let pulled = 0;
    const orig = g.client.iterDownload.bind(g.client);
    g.client.iterDownload = (o: any) => { const it = orig(o); return (async function* () { for await (const c of it) { pulled++; yield c; } })(); };
    await all(new GramjsApi(g.client, "me").download(1, 0, 100));
    assert.equal(pulled, 1, "one block was enough for 100 bytes");
  });

  it("reads new messages oldest first and tells documents apart from plain text", async () => {
    const g = fakeGram(data, [message(7, "SD1 {\"n\":\"b\"}"), message(5, "SD1 {\"n\":\"a\"}", doc(10, "image/jpeg")), new Api.MessageService({ id: 6, peerId: new Api.PeerChannel({ channelId: bigInt(5) }), date: 1, action: new Api.MessageActionChatCreate({ title: "x", users: [] }) })]);
    const got = await new GramjsApi(g.client, "me").after(0, 100);
    assert.deepEqual(got.map((m) => m.id), [5, 7], "service messages are skipped, the rest ascending");
    assert.deepEqual(got[0]!.doc, { size: 10, mime: "image/jpeg", hasThumb: false }); assert.equal(got[1]!.doc, null);
    assert.deepEqual((await new GramjsApi(g.client, "me").after(5, 100)).map((m) => m.id), [7]);
  });

  it("explains failures in plain words and marks an expired session for reconnecting", () => {
    const kind = (m: string) => mapTelegramError(Object.assign(new Error(m), { errorMessage: m })).kind;
    assert.equal(kind("AUTH_KEY_UNREGISTERED"), "auth"); assert.equal(kind("SESSION_REVOKED"), "auth"); assert.equal(kind("USER_DEACTIVATED"), "auth");
    assert.equal(kind("FLOOD_WAIT_30"), "rate"); assert.equal(kind("CHANNEL_PRIVATE"), "other"); assert.equal(kind("ETIMEDOUT"), "network"); assert.equal(kind("surprise"), "other");
    const own = new ProviderError("x", "conflict"); assert.equal(mapTelegramError(own), own, "adapter errors pass through untouched");
  });
});
