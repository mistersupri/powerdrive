import type { FileEntry, RenamePreviewItem, RenameRule } from "@superdrive/shared";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, Input, Select } from "@/ui/Field";

type Num = "off" | "prefix" | "suffix" | "replace";

/** Bulk rename: several items at once by find/replace, case, prefix/suffix and numbering, with a before/after preview that the server computes (and checks for clashes). */
export function RenameTool({ open, storageId, entries, onClose, onDone }: { open: boolean; storageId: string; entries: FileEntry[]; onClose(): void; onDone(): void }) {
  const [find, setFind] = useState(""); const [replace, setReplace] = useState(""); const [regex, setRegex] = useState(false); const [matchCase, setMatchCase] = useState(false);
  const [casing, setCasing] = useState<NonNullable<RenameRule["casing"]>>("keep"); const [prefix, setPrefix] = useState(""); const [suffix, setSuffix] = useState("");
  const [num, setNum] = useState<Num>("off"); const [start, setStart] = useState(1); const [pad, setPad] = useState(2); const [lowerExt, setLowerExt] = useState(false);
  const [rows, setRows] = useState<RenamePreviewItem[]>([]); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setFind(""); setReplace(""); setRegex(false); setMatchCase(false); setCasing("keep"); setPrefix(""); setSuffix(""); setNum("off"); setStart(1); setPad(2); setLowerExt(false); setRows([]); setErr(""); } }, [open]);

  const rule = useMemo<RenameRule>(() => ({
    ...(find ? { find, replace, regex, matchCase } : {}), casing, prefix, suffix, extension: lowerExt ? "lower" : "keep",
    ...(num !== "off" ? { numbering: { start, step: 1, pad, where: num, sep: " " } } : {}),
  }), [find, replace, regex, matchCase, casing, prefix, suffix, num, start, pad, lowerExt]);
  const ids = useMemo(() => entries.map((e) => e.id), [entries]);

  useEffect(() => {
    if (!open || !ids.length) return;
    let live = true;
    const timer = setTimeout(async () => {
      try { const r = await api<{ items: RenamePreviewItem[] }>("/files/rename-batch", { body: { storageId, fileIds: ids, rule, dryRun: true } }); if (live) { setRows(r.items); setErr(""); } }
      catch (e) { if (live) setErr((e as Error).message); }
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [open, storageId, ids, rule]);

  const okCount = rows.filter((r) => r.status === "ok").length; const bad = rows.filter((r) => r.status === "error").length;
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api<{ renamed: number; items: RenamePreviewItem[] }>("/files/rename-batch", { body: { storageId, fileIds: ids, rule } });
      const failed = r.items.filter((i) => i.status === "error").length;
      toast.success(`${r.renamed} item diganti nama${failed ? `, ${failed} dilewati` : ""}`); onDone(); onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} width="max-w-2xl" title={`Ganti nama ${entries.length} item`}
      footer={<><span className="mr-auto self-center text-[12px] text-muted" aria-live="polite">{bad ? `${bad} tidak bisa diganti, akan dilewati` : okCount ? `${okCount} akan diganti` : "Belum ada perubahan"}</span><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={busy} disabled={!okCount} onClick={apply}>Ganti nama</Button></>}>
      {err && <p role="alert" className="mb-3 text-[13px] text-danger-ink">{err}</p>}
      <div className="mb-4 max-h-40 sm:max-h-52 overflow-auto rounded-lg border border-line" role="table" aria-label="Pratinjau nama baru">
        {rows.map((r) => (
          <div key={r.fileId} role="row" className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 border-b border-line px-3 py-1.5 text-[13px] last:border-0">
            <span className="truncate text-muted" title={r.from}>{r.from}</span><span aria-hidden className="text-faint">→</span>
            <span className={cn("truncate", r.status === "error" ? "text-danger-ink" : r.status === "same" ? "text-faint" : "font-medium text-ink")} title={r.error ?? r.to}>{r.to}{r.error && <span className="block text-[11px] font-normal">{r.error}</span>}</span>
          </div>
        ))}
        {!rows.length && !err && <p className="px-3 py-4 text-center text-[13px] text-muted">Memuat pratinjau…</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1"><Field label="Cari">{(id) => <Input id={id} value={find} onChange={(e) => setFind(e.target.value)} placeholder="mis. IMG_" />}</Field></div>
        <div className="col-span-2 sm:col-span-1"><Field label="Ganti dengan">{(id) => <Input id={id} value={replace} onChange={(e) => setReplace(e.target.value)} disabled={!find} placeholder="kosongkan untuk menghapus" />}</Field></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 col-span-2">
          <label className="inline-flex items-center gap-2 text-[13px]"><input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> Pola regex</label>
          <label className="inline-flex items-center gap-2 text-[13px]"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Bedakan huruf besar/kecil</label>
          <label className="inline-flex items-center gap-2 text-[13px]"><input type="checkbox" checked={lowerExt} onChange={(e) => setLowerExt(e.target.checked)} /> Ekstensi huruf kecil</label>
        </div>
        <div className="col-span-2 sm:col-span-1"><Field label="Huruf">{(id) => <Select id={id} value={casing} onChange={(e) => setCasing(e.target.value as typeof casing)}><option value="keep">Biarkan</option><option value="lower">huruf kecil</option><option value="upper">HURUF BESAR</option><option value="title">Awal Kata Besar</option></Select>}</Field></div>
        <div className="col-span-2 sm:col-span-1"><Field label="Penomoran">{(id) => <Select id={id} value={num} onChange={(e) => setNum(e.target.value as Num)}><option value="off">Tanpa nomor</option><option value="suffix">Nomor di belakang nama</option><option value="prefix">Nomor di depan nama</option><option value="replace">Ganti seluruh nama dengan nomor</option></Select>}</Field></div>
        <Field label="Awalan">{(id) => <Input id={id} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="mis. Liburan " />}</Field>
        <Field label="Akhiran">{(id) => <Input id={id} value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="mis. _final" />}</Field>
        {num !== "off" && <>
          <Field label="Mulai dari">{(id) => <Input id={id} type="number" min={0} value={start} onChange={(e) => setStart(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />}</Field>
          <Field label="Jumlah digit" hint="2 menghasilkan 01, 02, …">{(id) => <Input id={id} type="number" min={0} max={10} value={pad} onChange={(e) => setPad(Math.min(10, Math.max(0, Math.floor(Number(e.target.value) || 0))))} />}</Field>
        </>}
      </div>
    </Dialog>
  );
}
