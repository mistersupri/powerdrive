// Waits until the test SFTP server accepts the test login, so the tests never start against a server that is not ready
// (or that refuses password login). Used by the Release workflow after scripts/ci-external-servers.sh.
const path = require("node:path");
const { Client } = require(require.resolve("ssh2", { paths: [path.join(__dirname, "..", "apps", "api")] }));
const [host, port, username, password] = (process.env.SD_TEST_SFTP ?? "127.0.0.1:2222:sduser:pass123").split(":");
const attempts = Number(process.env.SD_WAIT_ATTEMPTS ?? 20);
const once = () => new Promise((resolve) => {
  const c = new Client();
  c.on("ready", () => { c.end(); resolve(null); }).on("error", (e) => resolve(e.message));
  c.connect({ host, port: Number(port), username, password, readyTimeout: 5000 });
});
(async () => {
  let last = "";
  for (let i = 1; i <= attempts; i++) {
    last = await once();
    if (!last) { console.log(`SFTP test login ok (attempt ${i})`); return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`SFTP test login failed after ${attempts} attempts: ${last}`);
  process.exit(1);
})();
