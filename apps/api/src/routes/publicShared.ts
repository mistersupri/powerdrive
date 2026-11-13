import type { FastifyRequest } from "fastify";
export const COOKIE_PATH_PREFIX = "/api/v1/public/share";
export function ok<T>(req: FastifyRequest, data: T) { return { success: true as const, data, meta: { requestId: req.id } }; }
