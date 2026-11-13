import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { openDb } from "./db.ts";
import { startScheduler } from "./scheduler.ts";
import { engine } from "./modules/transfers.ts";
import { recoverUploads } from "./modules/uploads.ts";
import { currentKeyVersion } from "./lib/crypto.ts";

async function main() {
  if (config.isProd && config.sessionSecret === "dev-only-session-secret-change-me") throw new Error("SESSION_SECRET wajib diubah di production.");
  currentKeyVersion(); // fail fast on a bad master key
  openDb();
  const app = await buildApp();
  engine.start();
  recoverUploads();
  const stopScheduler = startScheduler(app.log as any);
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`SuperDrive siap di ${config.appUrl}`);

  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return; closing = true;
    app.log.info(`${sig}: menutup dengan rapi`);
    stopScheduler();
    await engine.stop();              // pauses running transfers so they resume after restart
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
main().catch((e) => { console.error(e); process.exit(1); });
