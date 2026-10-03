import React, { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Folder, FileItem } from "../types/frontend.ts";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "../ui/Dialog.tsx";
import { Button } from "../ui/Button.tsx";
import { Field, TextInput } from "../ui/Field.tsx";

interface InlineRenameModalProps {
  item: { type: "folder"; data: Folder } | { type: "file"; data: FileItem };
  onClose: () => void;
  onSave: (newName: string) => Promise<void>;
}

export const InlineRenameModal: React.FC<InlineRenameModalProps> = ({ item, onClose, onSave }) => {
  const initialName = item.type === "folder" ? item.data.name : item.data.originalName;
  const [name, setName] = useState(initialName);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Select the name without its extension so typing replaces only the name.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.focus();
      const dot = initialName.lastIndexOf(".");
      if (item.type === "file" && dot > 0) el.setSelectionRange(0, dot);
      else el.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [initialName, item.type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setError("Nama tidak boleh kosong.");
      return;
    }
    if (clean === initialName) {
      onClose();
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(clean);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Nama gagal diubah.");
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="sm" dismissible={!isSaving}>
      <form onSubmit={handleSubmit} noValidate>
        <DialogHeader
          icon={<Pencil className="w-4 h-4" />}
          title={item.type === "folder" ? "Ubah nama folder" : "Ubah nama berkas"}
          onClose={onClose}
        />
        <DialogBody>
          <Field label="Nama baru" error={error}>
            <TextInput ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} disabled={isSaving} maxLength={255} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onClose} disabled={isSaving}>
            Batal
          </Button>
          <Button type="submit" variant="primary" size="md" loading={isSaving} disabled={!name.trim()}>
            Simpan
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
};
