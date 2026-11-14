import type { FastifyInstance } from "fastify";
import { authRoutes } from "./auth.ts";
import { workspaceRoutes } from "./workspaces.ts";
import { storageRoutes } from "./storages.ts";
import { fileRoutes } from "./files.ts";
import { transferRoutes } from "./transfers.ts";
import { miscRoutes } from "./misc.ts";
import { directShareRoutes, publicRoutes } from "./public.ts";
import { shareRoutes } from "./shares.ts";
import { trashRoutes } from "./trash.ts";

export async function registerRoutes(app: FastifyInstance) {
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(workspaceRoutes, { prefix: "/workspaces" });
  await app.register(storageRoutes);
  await app.register(fileRoutes);
  await app.register(transferRoutes);
  await app.register(miscRoutes);
  await app.register(shareRoutes);
  await app.register(trashRoutes);
  await app.register(publicRoutes, { prefix: "/public" });
  await app.register(directShareRoutes, { prefix: "/shared" });
}
