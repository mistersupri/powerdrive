import React, { useEffect, useState } from "react";
import { FolderPlus } from "lucide-react";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "../../ui/Dialog.tsx";
import { Button } from "../../ui/Button.tsx";
import { Field, TextArea, TextInput } from "../../ui/Field.tsx";

/** New folder form shared by My Drive and mounted drives. */
export function CreateFolderDialog({
  open,
  onClose,
  onCreate,
  parentName,
  withDescription = true,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description?: string) => Promise<void>;
  parentName: string;
  withDescription?: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Nama folder wajib diisi.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed, description.trim() || undefined);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Folder gagal dibuat.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="sm" dismissible={!busy}>
      <form onSubmit={submit} noValidate>
        <DialogHeader
          icon={<FolderPlus className="w-5 h-5" />}
          title="Folder baru"
          description={<>Dibuat di dalam <strong className="font-semibold text-ink-700">{parentName}</strong></>}
          onClose={onClose}
        />
        <DialogBody className="space-y-4">
          <Field label="Nama folder" error={error}>
            <TextInput
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Misal: Laporan Kegiatan 2026"
              maxLength={200}
              aria-invalid={!!error}
            />
          </Field>
          {withDescription && (
            <Field label="Keterangan" hint="Opsional">
              <TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Isi folder ini secara singkat" />
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" variant="primary" size="md" loading={busy}>
            Buat folder
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
