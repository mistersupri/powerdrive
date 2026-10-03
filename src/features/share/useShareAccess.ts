import { useCallback, useEffect, useState } from "react";
import { api } from "../../services/api.ts";
import { FileItem, Folder, FolderPermission } from "../../types/frontend.ts";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readGateParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    return { pwdHash: p.get("pwdHash"), emails: p.get("emails") };
  } catch {
    return { pwdHash: null, emails: null };
  }
}

export type ShareState =
  | { kind: "loading" }
  | { kind: "gate"; needsPassword: boolean; needsEmail: boolean; error?: string }
  | { kind: "error"; message: string }
  | { kind: "folder"; folder: Folder; permission: FolderPermission }
  | { kind: "file"; file: FileItem };

/** Verifies a signed share link (and its password/email gate) and resolves what it opens. */
export function useShareAccess({
  folderId,
  fileId,
  permParam,
  signature,
}: {
  folderId?: string;
  fileId?: string;
  permParam?: string | null;
  signature?: string | null;
}) {
  const [gate] = useState(readGateParams);
  const needsGate = !!(gate.pwdHash || gate.emails);
  const [state, setState] = useState<ShareState>(
    needsGate ? { kind: "gate", needsPassword: !!gate.pwdHash, needsEmail: !!gate.emails } : { kind: "loading" }
  );

  const verify = useCallback(
    async (password?: string, email?: string) => {
      const requested = permParam === "EDIT" ? FolderPermission.EDIT : FolderPermission.VIEW;
      try {
        if (signature) {
          const pwdHash = password ? await sha256(password) : gate.pwdHash || undefined;
          const res = await api.verifyShareToken({
            folderId,
            fileId,
            permission: requested,
            signature,
            pwdHash,
            emails: gate.emails || undefined,
            emailInput: email,
          });
          if (!res.isValid) throw new Error("Tautan ini tidak valid atau sudah diubah.");
          if (fileId && res.file) return setState({ kind: "file", file: res.file });
          if (res.folder) {
            return setState({
              kind: "folder",
              folder: res.folder,
              permission: (res.grantedPermission as FolderPermission) || requested,
            });
          }
          throw new Error("Isi tautan tidak ditemukan.");
        }
        // Older links without a signature only open items that are already public.
        if (fileId) {
          const { file } = await api.getFile(fileId);
          return setState({ kind: "file", file });
        }
        if (folderId) {
          const { folder } = await api.getFolder(folderId);
          return setState({ kind: "folder", folder, permission: folder.permission || FolderPermission.VIEW });
        }
        throw new Error("Tautan tidak lengkap.");
      } catch (err: any) {
        const message = err?.message || "Tautan tidak dapat dibuka.";
        if (needsGate) setState({ kind: "gate", needsPassword: !!gate.pwdHash, needsEmail: !!gate.emails, error: message });
        else setState({ kind: "error", message });
      }
    },
    [folderId, fileId, permParam, signature, gate, needsGate]
  );

  useEffect(() => {
    if (!needsGate) verify();
  }, [needsGate, verify]);

  return {
    state,
    retry: () => {
      setState({ kind: "loading" });
      verify();
    },
    submitGate: (password: string, email: string) => verify(password || undefined, email || undefined),
  };
}
