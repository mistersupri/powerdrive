import React, { useState } from "react";
import { Download, Eye, Link2Off, Lock, LogIn, RotateCw } from "lucide-react";
import { FileItem } from "../../types/frontend.ts";
import { formatBytes } from "../../lib/format.ts";
import { categoryLabel, getFileCategory } from "../../lib/fileType.ts";
import { Button } from "../../ui/Button.tsx";
import { Field, TextInput } from "../../ui/Field.tsx";
import { FileTypeIcon } from "../../ui/FileTypeIcon.tsx";
import { ThemeToggle } from "../../ui/ThemeToggle.tsx";
import { Wordmark } from "../../ui/Wordmark.tsx";

/** Top bar for everything opened through a share link. */
export function ShareHeader({ context, onGoToLogin }: { context?: React.ReactNode; onGoToLogin: () => void }) {
  return (
    <header className="h-14 shrink-0 bg-canvas border-b border-ink-200 px-3 sm:px-5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <Wordmark className="text-lg" />
        {context && <span className="hidden sm:block text-sm text-ink-500 truncate">{context}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <Button icon={<LogIn className="w-4 h-4" />} onClick={onGoToLogin}>
          Masuk
        </Button>
      </div>
    </header>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface border border-ink-200 rounded-2xl p-6 sm:p-7 animate-dialog-in">{children}</div>
    </div>
  );
}

export function ShareGate({
  needsPassword,
  needsEmail,
  error,
  onSubmit,
}: {
  needsPassword: boolean;
  needsEmail: boolean;
  error?: string;
  onSubmit: (password: string, email: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <CenteredCard>
      <div className="w-11 h-11 rounded-xl bg-ink-100 text-ink-700 flex items-center justify-center mb-4">
        <Lock className="w-5 h-5" />
      </div>
      <h1 className="text-lg font-bold text-ink-900">Tautan ini dilindungi</h1>
      <p className="text-sm text-ink-500 mt-1 mb-5">
        {needsPassword && needsEmail
          ? "Masukkan kata sandi tautan dan email Anda yang terdaftar."
          : needsPassword
            ? "Masukkan kata sandi yang diberikan oleh pemilik tautan."
            : "Masukkan alamat email yang diberi akses oleh pemilik tautan."}
      </p>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onSubmit(password, email);
          setBusy(false);
        }}
      >
        {needsPassword && (
          <Field label="Kata sandi tautan">
            <TextInput type="password" required autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
        )}
        {needsEmail && (
          <Field label="Email Anda">
            <TextInput type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger-700 bg-danger-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="md" loading={busy} className="w-full">
          Buka tautan
        </Button>
      </form>
    </CenteredCard>
  );
}

export function ShareError({ message, onRetry, onGoToLogin }: { message: string; onRetry: () => void; onGoToLogin: () => void }) {
  return (
    <CenteredCard>
      <div className="w-11 h-11 rounded-xl bg-danger-50 text-danger-600 flex items-center justify-center mb-4">
        <Link2Off className="w-5 h-5" />
      </div>
      <h1 className="text-lg font-bold text-ink-900">Tautan tidak dapat dibuka</h1>
      <p className="text-sm text-ink-500 mt-1 leading-relaxed">{message}</p>
      <p className="text-sm text-ink-500 mt-2 leading-relaxed">
        Isinya mungkin sudah dihapus atau aksesnya dicabut. Minta pemilik mengirim tautan baru.
      </p>
      <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2">
        <Button size="md" icon={<RotateCw className="w-4 h-4" />} onClick={onRetry} className="flex-1">
          Coba lagi
        </Button>
        <Button size="md" variant="primary" icon={<LogIn className="w-4 h-4" />} onClick={onGoToLogin} className="flex-1">
          Masuk
        </Button>
      </div>
    </CenteredCard>
  );
}

export function SharedFileCard({ file, onPreview, onDownload }: { file: FileItem; onPreview: () => void; onDownload: () => void }) {
  const category = getFileCategory(file.mimeType, file.originalName);
  return (
    <CenteredCard>
      <div className="w-14 h-14 rounded-2xl bg-ink-100 flex items-center justify-center mb-4">
        <FileTypeIcon category={category} className="w-7 h-7 text-ink-700" />
      </div>
      <h1 className="text-lg font-bold text-ink-900 break-words">{file.originalName}</h1>
      <p className="text-sm text-ink-500 mt-1 tabular">
        {categoryLabel[category]} · {formatBytes(file.size)}
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="primary" size="md" icon={<Eye className="w-4 h-4" />} onClick={onPreview} autoFocus>
          Lihat pratinjau
        </Button>
        <Button size="md" icon={<Download className="w-4 h-4" />} onClick={onDownload}>
          Unduh
        </Button>
      </div>
    </CenteredCard>
  );
}
