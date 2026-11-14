import assert from "node:assert/strict";
import net from "node:net";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import { bootstrap } from "./helpers.ts";

let t: Awaited<ReturnType<typeof bootstrap>>;
let wsId = ""; let sid = "";
const patch = (body: any) => t.call("ana", "PATCH", "/admin/settings", body);
const unlock = async () => { await patch({ registration: { mode: "open" }, guest: { allowLinks: true, allowUploads: true, requirePassword: false, maxExpiryDays: 0, defaultExpiryDays: 0 }, security: { mfa: "off", idleTimeoutMinutes: 0 } }); };

before(async () => {
  t = await bootstrap(); await t.register("ana");
  const me = (await t.call("ana", "GET", "/auth/me")).data; wsId = me.activeWorkspaceId;
  sid = (await t.call("ana", "GET", "/storages")).data.find((s: any) => s.isDefault).id;
});
after(async () => { await t.app.close(); });

describe("system settings", () => {
  it("are for the super admin only, and secrets never come back", async () => {
    await t.register("bo");
    assert.equal((await t.call("bo", "GET", "/admin/settings")).status, 403);
    assert.equal((await t.call("bo", "PATCH", "/admin/settings", { registration: { mode: "closed" } })).status, 403);
    assert.equal((await t.call("", "GET", "/admin/settings")).status, 401);
    const s = (await t.call("ana", "GET", "/admin/settings")).data; assert.equal(s.registration.mode, "open"); assert.equal(s.email.hasPassword, false); assert.ok(!("passwordSealed" in s.email) && !("password" in s.email));
    assert.equal((await patch({ registration: { mode: "nonsense" } })).status, 400, "values are validated");
    assert.equal((await patch({ bogus: {} })).status, 400, "unknown sections are rejected");
    const pub = (await t.call("", "GET", "/branding")).data; assert.equal(pub.appName, "SuperDrive"); assert.equal(pub.registration, "open"); assert.ok(!JSON.stringify(pub).includes("email"), "nothing private on the public endpoint");
  });

  it("registration: open, invite-only, or closed even for invitations", async () => {
    const invite = async (email: string) => new URL((await t.call("ana", "POST", `/workspaces/${wsId}/invitations`, { email, role: "MEMBER" })).data.link).searchParams.get("invitation");
    await patch({ registration: { mode: "invite" } });
    assert.equal((await t.register("cy1")).status, 403, "no invitation, no account");
    const tok = await invite("cy2@example.com"); assert.equal((await t.register("cy2", { invitationToken: tok })).status, 200, "an invitation still works");
    assert.equal((await t.call("", "GET", "/branding")).data.registration, "invite");
    await patch({ registration: { mode: "closed" } });
    const tok2 = await invite("cy3@example.com"); const closed = await t.register("cy3", { invitationToken: tok2 }); assert.equal(closed.status, 403); assert.equal(closed.body.error.code, "REGISTRATION_CLOSED");
    await patch({ registration: { mode: "open" } }); assert.equal((await t.register("cy4")).status, 200);
  });

  it("guest access: links on/off, uploads, forced password, expiry cap", async () => {
    const dir = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Tamu" })).data.id;
    const link = (await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dir, role: "EDITOR" })).data; const tok = link.url.split("/share/")[1];
    assert.equal((await t.call("", "GET", `/public/share/${tok}`)).status, 200);
    await patch({ guest: { allowUploads: false } });
    assert.equal((await t.call("", "POST", `/public/share/${tok}/folders`, { name: "x" })).status, 403, "an existing editor link stops accepting writes");
    assert.equal((await t.call("", "GET", `/public/share/${tok}/list`)).status, 200, "but still shows its contents");
    assert.equal((await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dir, role: "EDITOR", newLink: true })).status, 403);
    assert.equal((await t.call("ana", "PATCH", `/shares/${link.id}`, { role: "EDITOR" })).data.role, "EDITOR", "no change, no error");
    await patch({ guest: { allowUploads: true, requirePassword: true } });
    assert.equal((await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dir, role: "VIEWER", newLink: true })).status, 400, "password is mandatory");
    const pw = (await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dir, role: "VIEWER", newLink: true, password: "rahasia1" })).data; assert.equal(pw.hasPassword, true);
    assert.equal((await t.call("ana", "PATCH", `/shares/${pw.id}`, { password: null })).status, 400, "and cannot be removed");
    await patch({ guest: { requirePassword: false, maxExpiryDays: 7, defaultExpiryDays: 3 } });
    assert.equal((await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dir, role: "VIEWER", newLink: true, expiresInDays: 30 })).status, 400, "longer than the cap is refused");
    const d = (await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dir, role: "VIEWER", newLink: true })).data;
    const days = (Date.parse(d.expiresAt) - Date.now()) / 86_400_000; assert.ok(days > 2.9 && days < 3.1, `default expiry applied (${days.toFixed(2)} d)`);
    assert.equal((await t.call("ana", "PATCH", `/shares/${d.id}`, { expiresInDays: null })).data.expiresAt !== null, true, "the cap also applies when removing the expiry");
    await patch({ guest: { allowLinks: false } });
    assert.equal((await t.call("", "GET", `/public/share/${tok}`)).status, 404, "every public link stops working");
    assert.equal((await t.call("ana", "POST", "/shares", { storageId: sid, fileId: dir, role: "VIEWER", newLink: true })).status, 403);
    const viv = (await t.call("cy4", "GET", "/auth/me")).data.user.id; void viv;
    await unlock(); assert.equal((await t.call("", "GET", `/public/share/${tok}`)).status, 200, "and come back when switched on again");
  });

  it("retention: old audit rows, activity and finished transfers go; trash lifetime follows the setting", async () => {
    const { db } = await import("../db.ts"); const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    db.run("INSERT INTO audit_logs(id, workspace_id, action, resource_type, created_at) VALUES ('old-a', ?, 'x', 'x', ?)", wsId, old);
    db.run("INSERT INTO file_activity(id, workspace_id, storage_id, file_id, actor, action, created_at) VALUES ('old-f', ?, ?, 'f', 'u', 'view', ?)", wsId, sid, old);
    const r0 = (await t.call("ana", "POST", "/admin/retention/run")).data; assert.equal(r0.audit, 0, "0 days means keep everything");
    assert.ok(db.get("SELECT 1 FROM audit_logs WHERE id = 'old-a'"));
    await patch({ retention: { auditDays: 30 } });
    const r = (await t.call("ana", "POST", "/admin/retention/run")).data; assert.ok(r.audit >= 1 && r.activity >= 1, JSON.stringify(r));
    assert.equal(db.get("SELECT 1 FROM audit_logs WHERE id = 'old-a'"), undefined); assert.ok(db.get("SELECT 1 FROM audit_logs ORDER BY created_at DESC LIMIT 1"), "recent rows stay");
    assert.equal((await patch({ retention: { trashDays: 0 } })).status, 400);
    await patch({ retention: { trashDays: 3 } });
    const f = (await t.call("ana", "POST", "/files/folders", { storageId: sid, name: "Sampah-uji" })).data.id; await t.call("ana", "DELETE", `/files/${sid}/${f}`).catch(() => {});
    await t.call("ana", "POST", "/files/delete", { storageId: sid, ids: [f] }).catch(() => {});
    const it = (await t.call("ana", "GET", "/trash")).data.items.find((x: any) => x.name === "Sampah-uji");
    if (it) { const d = (Date.parse(it.expiresAt) - Date.now()) / 86_400_000; assert.ok(d > 2.9 && d < 3.1, `trash expiry follows the setting (${d.toFixed(2)} d)`); }
  });
});

describe("two-step verification and sessions", () => {
  const { totp } = await_totp();
  function await_totp() { return { totp: (s: string, off = 0) => import("../lib/totp.ts").then((m) => m.totp(s, Date.now(), off)) }; }
  let secret = ""; let recovery: string[] = [];
  const login = (who: string, email = `${who}@example.com`) => t.call(who, "POST", "/auth/login", { email, password: "password123" });
  it("enrolment needs a valid code, then sign-in becomes two steps", async () => {
    await t.register("mia");
    assert.equal((await t.call("mia", "GET", "/auth/mfa")).data.enabled, false);
    const s = (await t.call("mia", "POST", "/auth/mfa/setup")).data; secret = s.secret; assert.match(s.secret, /^[A-Z2-7]{32}$/); assert.ok(s.qrSvg.startsWith("<svg") || s.qrSvg.includes("<svg")); assert.ok(s.otpauthUrl.startsWith("otpauth://totp/"));
    assert.equal((await t.call("mia", "POST", "/auth/mfa/enable", { code: "000000" })).status, 400, "a wrong code does not enable it");
    const en = await t.call("mia", "POST", "/auth/mfa/enable", { code: await totp(secret) }); assert.equal(en.status, 200, JSON.stringify(en.body)); recovery = en.data.recoveryCodes; assert.equal(recovery.length, 10);
    const l = await login("mia2", "mia@example.com"); assert.equal(l.data.mfaRequired, true); assert.ok(l.data.challenge); assert.ok(!l.res.headers["set-cookie"], "no session before the second step");
    assert.equal((await t.call("mia2", "GET", "/auth/me")).status, 401);
    assert.equal((await t.call("mia2", "POST", "/auth/mfa/verify", { challenge: l.data.challenge, code: "123456" })).status, 401);
    const ok = await t.call("mia2", "POST", "/auth/mfa/verify", { challenge: l.data.challenge, code: await totp(secret, 1) }); assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await t.call("mia2", "GET", "/auth/me")).status, 200, "the session works after the second step");
  });
  it("a code works once, five wrong tries burn the challenge, recovery codes are single use", async () => {
    const used = await totp(secret, 1);
    const l1 = await login("mia3", "mia@example.com"); assert.equal((await t.call("mia3", "POST", "/auth/mfa/verify", { challenge: l1.data.challenge, code: used })).status, 401, "replaying a code is refused");
    const l2 = await login("mia4", "mia@example.com"); for (let i = 0; i < 5; i++) await t.call("mia4", "POST", "/auth/mfa/verify", { challenge: l2.data.challenge, code: "111111" });
    assert.equal((await t.call("mia4", "POST", "/auth/mfa/verify", { challenge: l2.data.challenge, code: await totp(secret, -1) })).status, 401, "the challenge is gone after too many tries");
    const l3 = await login("mia5", "mia@example.com"); assert.equal((await t.call("mia5", "POST", "/auth/mfa/verify", { challenge: l3.data.challenge, recoveryCode: recovery[0] })).status, 200);
    const l4 = await login("mia6", "mia@example.com"); assert.equal((await t.call("mia6", "POST", "/auth/mfa/verify", { challenge: l4.data.challenge, recoveryCode: recovery[0] })).status, 401, "a recovery code is single use");
    assert.equal((await t.call("mia5", "GET", "/auth/mfa")).data.recoveryLeft, 9);
  });
  it("the administrator can require it: accounts without it can only set it up", async () => {
    await patch({ security: { mfa: "admins" } });
    const blocked = await t.call("ana", "GET", `/files?storageId=${sid}`); assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, "MFA_SETUP_REQUIRED");
    assert.equal((await t.call("ana", "GET", "/auth/me")).status, 200, "signing in and enrolling stay possible");
    assert.equal((await t.call("mia5", "GET", `/files?storageId=${(await t.call("mia5", "GET", "/storages")).data[0].id}`)).status, 200, "not an admin of anything shared, and already enrolled: unaffected");
    const s = (await t.call("ana", "POST", "/auth/mfa/setup")).data; const en = await t.call("ana", "POST", "/auth/mfa/enable", { code: await totp(s.secret) }); assert.equal(en.status, 200);
    assert.equal((await t.call("ana", "GET", `/files?storageId=${sid}`)).status, 200, "unblocked once enrolled");
    assert.equal((await t.call("ana", "POST", "/auth/mfa/disable", { password: "password123" })).status, 403, "and cannot be switched off while required");
    await patch({ security: { mfa: "off" } });
    assert.equal((await t.call("ana", "POST", "/auth/mfa/disable", { password: "wrong" })).status, 400);
    assert.equal((await t.call("ana", "POST", "/auth/mfa/disable", { password: "password123" })).status, 200);
  });
  it("inactivity timeout ends idle sessions but not active ones", async () => {
    const { db } = await import("../db.ts"); await patch({ security: { idleTimeoutMinutes: 5 } });
    await t.register("ida"); const login2 = await login("ida2", "ida@example.com"); assert.equal(login2.status, 200);
    db.run("UPDATE sessions SET last_seen_at = ? WHERE user_id = (SELECT id FROM users WHERE email = 'ida@example.com')", new Date(Date.now() - 6 * 60_000).toISOString());
    assert.equal((await t.call("ida2", "GET", "/auth/me")).status, 401, "idle for longer than the limit");
    const l = await login("ida3", "ida@example.com"); assert.equal(l.status, 200);
    db.run("UPDATE sessions SET last_seen_at = ? WHERE user_id = (SELECT id FROM users WHERE email = 'ida@example.com')", new Date(Date.now() - 2 * 60_000).toISOString());
    assert.equal((await t.call("ida3", "GET", "/auth/me")).status, 200, "recent activity keeps it alive");
    assert.equal((await t.call("ida3", "GET", "/auth/me")).data.policy.idleTimeoutMinutes, 5, "the client learns the limit");
    await patch({ security: { idleTimeoutMinutes: 0 } });
  });
});

describe("email, branding", () => {
  let server: net.Server; let port = 0; const inbox: string[] = [];
  before(async () => {
    server = net.createServer((sock) => {
      let data = false; let buf = ""; sock.write("220 test ESMTP\r\n");
      sock.on("data", (c) => { for (const line of c.toString().split("\r\n")) { if (!line) continue;
        if (data) { if (line === ".") { data = false; inbox.push(buf); buf = ""; sock.write("250 queued\r\n"); } else buf += line + "\n"; continue; }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") sock.write("250-test\r\n250 8BITMIME\r\n"); else if (cmd === "MAIL" || cmd === "RCPT") sock.write("250 ok\r\n"); else if (cmd === "DATA") { data = true; sock.write("354 go\r\n"); } else if (cmd === "QUIT") { sock.write("221 bye\r\n"); sock.end(); } else sock.write("250 ok\r\n"); } });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r())); port = (server.address() as net.AddressInfo).port;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));
  it("sends through the configured SMTP server: test mail, password reset, invitations", async () => {
    assert.equal((await t.call("ana", "POST", "/admin/email/test", { to: "x@example.com" })).status, 400, "off until configured");
    assert.equal((await patch({ email: { enabled: true, host: "", fromAddress: "" } })).status, 400, "cannot enable without a server");
    const s = (await patch({ email: { enabled: true, host: "127.0.0.1", port, secure: false, fromName: "Drive Kantor", fromAddress: "drive@kantor.test", password: "rahasia-smtp" } })).data; assert.equal(s.email.hasPassword, true); assert.ok(!JSON.stringify(s).includes("rahasia-smtp"));
    assert.equal((await t.call("ana", "POST", "/admin/email/test", { to: "penerima@example.com" })).status, 200); assert.ok(inbox.at(-1)!.includes("Subject: Email uji") && inbox.at(-1)!.includes("drive@kantor.test"), inbox.at(-1));
    const n = inbox.length; await t.call("", "POST", "/auth/forgot-password", { email: "bo@example.com" }); await t.wait(() => inbox.length > n);
    const decoded = inbox.at(-1)!.replace(/=\r?\n/g, "").replace(/=3D/g, "="); assert.ok(decoded.includes("reset-password?token="), "the reset link is emailed, not just logged");
    const inv = (await t.call("ana", "POST", `/workspaces/${wsId}/invitations`, { email: "baru@example.com", role: "MEMBER" })).data; assert.equal(inv.emailed, true); assert.ok(inv.link.includes("invitation="));
    await patch({ email: { enabled: false } }); const inv2 = (await t.call("ana", "POST", `/workspaces/${wsId}/invitations`, { email: "lagi@example.com", role: "MEMBER" })).data; assert.equal(inv2.emailed, false, "without email the link is still shown to the inviter");
  });
  it("branding: name, accent colour with a contrast check, and an app icon in three sizes", async () => {
    assert.equal((await patch({ brand: { color: "#ffee99" } })).status, 400, "an accent that makes white text unreadable is refused");
    assert.equal((await patch({ brand: { color: "not-a-colour" } })).status, 400);
    const b = (await patch({ brand: { appName: "Drive Kantor", color: "#0b6e4f", defaultTheme: "dark", loginMessage: "Gunakan akun kantor." } })).data.brand; assert.equal(b.appName, "Drive Kantor");
    const pub = (await t.call("", "GET", "/branding")).data; assert.equal(pub.color, "#0b6e4f"); assert.equal(pub.loginMessage, "Gunakan akun kantor."); assert.equal(pub.iconUrl, null);
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: "#0b6e4f" } }).png().toBuffer();
    assert.equal((await t.call("bo", "PUT", "/admin/branding/icon", png, { "content-type": "image/png" })).status, 403);
    assert.equal((await t.call("ana", "PUT", "/admin/branding/icon", Buffer.from("this is not an image at all, just text padding".repeat(5)), { "content-type": "image/png" })).status, 400);
    assert.equal((await t.call("ana", "PUT", "/admin/branding/icon", await sharp({ create: { width: 40, height: 40, channels: 3, background: "#000" } }).png().toBuffer(), { "content-type": "image/png" })).status, 400, "too small");
    const up = await t.call("ana", "PUT", "/admin/branding/icon", png, { "content-type": "image/png" }); assert.equal(up.status, 200, JSON.stringify(up.body)); assert.ok(up.data.iconUrl.includes("/branding/icon/192?v="));
    for (const size of [32, 192, 512]) { const r = await t.app.inject({ method: "GET", url: `/api/v1/branding/icon/${size}` }); assert.equal(r.statusCode, 200); const m = await sharp(r.rawPayload).metadata(); assert.deepEqual([m.width, m.height, m.format], [size, size, "png"]); }
    assert.equal((await t.app.inject({ method: "GET", url: "/api/v1/branding/icon/100" })).statusCode, 404);
    const mf = (await t.app.inject({ method: "GET", url: "/manifest.webmanifest" })).json(); assert.equal(mf.name, "Drive Kantor"); assert.equal(mf.theme_color, "#0b6e4f"); assert.equal(mf.icons.length, 2);
    assert.equal((await t.call("ana", "DELETE", "/admin/branding/icon")).data.iconUrl, null); assert.equal((await t.app.inject({ method: "GET", url: "/api/v1/branding/icon/192" })).statusCode, 404);
  });
});
