import type { FileEntry } from "@superdrive/shared";
import { memo, useState } from "react";
import { thumbUrl } from "@/lib/api";
import { cn } from "@/lib/cn";
import { KIND_ICON, KIND_TONE, kindOf } from "@/lib/fileType";

/**
 * Thumbnail with a graceful icon underneath. The image only mounts when the (virtualized) row is on screen,
 * is requested at the size it is shown, and is pinned to the file version so the browser can cache it forever.
 */
export const FileThumb = memo(function FileThumb({ file, size = 256, className, iconClass }: { file: FileEntry; size?: number; className?: string; iconClass?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");
  const kind = kindOf(file);
  const Icon = KIND_ICON[kind];
  const useImg = file.hasThumbnail && !file.isFolder && state !== "fail";
  return (
    <div className={cn("relative grid place-items-center overflow-hidden", KIND_TONE[kind], className)}>
      <Icon className={cn("size-1/3 min-h-5 min-w-5 transition-opacity", useImg && state === "ok" && "opacity-0", iconClass)} aria-hidden strokeWidth={1.6} />
      {useImg && (
        <img
          src={thumbUrl(file.storageId, file.id, file.version, size)} alt="" loading="lazy" decoding="async" draggable={false}
          onLoad={() => setState("ok")} onError={() => setState("fail")}
          className={cn("thumb-img absolute inset-0 size-full object-cover", state === "ok" ? "opacity-100" : "opacity-0")}
        />
      )}
    </div>
  );
});
