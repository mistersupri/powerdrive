import type { ApiErr, ApiOk } from "@superdrive/shared";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const WS_KEY = "sd-workspace";
export const getWorkspaceId = () => { try { return localStorage.getItem(WS_KEY); } catch { return null; } };
export const setWorkspaceId = (id: string) => { try { localStorage.setItem(WS_KEY, id); } catch { /* private mode */ } };

type Listener = () => void;
const unauthorized = new Set<Listener>();
export const onUnauthorized = (fn: Listener) => { unauthorized.add(fn); return () => { unauthorized.delete(fn); }; };

interface Opts { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> }

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const ws = getWorkspaceId();
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    credentials: "same-origin",
    signal: opts.signal,
    headers: { "x-requested-with": "superdrive", ...(ws ? { "x-workspace-id": ws } : {}), ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: ApiOk<T> | ApiErr | null = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok || !json || json.success === false) {
    const err = json && json.success === false ? json.error : { code: "NETWORK", message: "Tidak dapat menghubungi server." };
    if (res.status === 401 && !path.startsWith("/auth/login")) unauthorized.forEach((f) => f());
    throw new ApiError(res.status, err.code, err.message);
  }
  return json.data;
}

/** Same-origin URLs the browser fetches directly (cookies ride along), so images and downloads stream natively. */
export const thumbUrl = (storageId: string, fileId: string, version: string | null, size = 256) =>
  `/api/v1/files/${storageId}/${fileId}/thumbnail?s=${size}${version ? `&v=${encodeURIComponent(version)}` : ""}`;
export const downloadUrl = (storageId: string, fileId: string) => `/api/v1/files/${storageId}/${fileId}/download`;
export const previewUrl = (storageId: string, fileId: string) => `/api/v1/files/${storageId}/${fileId}/preview`;
