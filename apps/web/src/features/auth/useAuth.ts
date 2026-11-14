import type { User, WorkspaceSummary } from "@superdrive/shared";
import { useQuery } from "@tanstack/react-query";
import { api, getWorkspaceId, setWorkspaceId } from "@/lib/api";

export interface Me { user: User; workspaces: WorkspaceSummary[]; activeWorkspaceId: string; policy?: { idleTimeoutMinutes: number } }

export function useMe() {
  return useQuery({
    queryKey: ["me"], staleTime: Infinity, retry: false,
    queryFn: async () => {
      const me = await api<Me>("/auth/me");
      // Keep the chosen workspace if the user still belongs to it; otherwise adopt the server default.
      const saved = getWorkspaceId();
      if (!saved || !me.workspaces.some((w) => w.id === saved)) setWorkspaceId(me.activeWorkspaceId);
      return me;
    },
  });
}
export function useWorkspace() {
  const me = useMe().data;
  const id = getWorkspaceId() ?? me?.activeWorkspaceId;
  const ws = me?.workspaces.find((w) => w.id === id) ?? me?.workspaces[0];
  return { workspace: ws, role: ws?.role ?? "VIEWER", isAdmin: ws?.role === "OWNER" || ws?.role === "ADMIN", user: me?.user };
}
