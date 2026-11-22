import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ok, requireAuth } from "../app.ts";
import { automationInput, automationRuns, createAutomation, deleteAutomation, listAutomations, runAutomationNow, setAutomationEnabled, updateAutomation } from "../modules/automations.ts";

export async function automationRoutes(app: FastifyInstance) {
  app.get("/automations", async (req) => ok(req, listAutomations(requireAuth(req))));
  app.post("/automations", async (req, reply) => { const a = await createAutomation(requireAuth(req), automationInput.parse(req.body)); return reply.status(201).send(ok(req, a)); });
  app.put("/automations/:id", async (req) => ok(req, await updateAutomation(requireAuth(req), (req.params as any).id, automationInput.parse(req.body))));
  app.patch("/automations/:id/enabled", async (req) => ok(req, await setAutomationEnabled(requireAuth(req), (req.params as any).id, z.object({ enabled: z.boolean() }).parse(req.body).enabled)));
  app.delete("/automations/:id", async (req) => { deleteAutomation(requireAuth(req), (req.params as any).id); return ok(req, {}); });
  // Run it now on what is already there; dryRun only says what it would do.
  app.post("/automations/:id/run", async (req) => ok(req, await runAutomationNow(requireAuth(req), (req.params as any).id, z.object({ dryRun: z.boolean().default(false) }).parse(req.body ?? {}).dryRun)));
  app.get("/automations/:id/runs", async (req) => ok(req, automationRuns(requireAuth(req), (req.params as any).id)));
}
