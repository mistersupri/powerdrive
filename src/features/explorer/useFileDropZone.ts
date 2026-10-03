import React, { useCallback, useRef, useState } from "react";

/**
 * Upload by dropping files from the desktop. Counts enter/leave pairs so the
 * overlay does not flicker when the pointer crosses child elements, and ignores
 * in-app drags (moving items between folders).
 */
export function useFileDropZone(onFiles: (files: File[]) => void, enabled = true) {
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);
  const cb = useRef(onFiles);
  cb.current = onFiles;

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setIsOver(true);
    },
    [enabled]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [enabled]
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setIsOver(false);
    },
    [enabled]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setIsOver(false);
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0) cb.current(files);
    },
    [enabled]
  );

  return { isOver, bind: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
