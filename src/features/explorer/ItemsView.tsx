import React from "react";
import { FileItem, Folder } from "../../types/frontend.ts";
import { FileTypeIcon, FolderGlyph } from "../../ui/FileTypeIcon.tsx";
import { entryKey } from "./types.ts";
import type { useExplorer } from "./useExplorer.ts";
import { Cell, FileCard, FolderCard, ItemGrid, ItemRow, ItemTable, NameCell, SectionHeader } from "./ExplorerParts.tsx";

export interface ColumnDef<T> {
  label: string;
  className?: string;
  render: (item: T) => React.ReactNode;
}

export interface ItemsViewProps {
  view: "grid" | "list";
  folders: Folder[];
  files: FileItem[];
  showFiles: boolean;
  explorer: ReturnType<typeof useExplorer>;
  folderTitle: string;
  folderAction?: React.ReactNode;
  fileHeaderExtra?: React.ReactNode;
  folderMeta: (f: Folder) => React.ReactNode;
  folderBadge?: (f: Folder) => React.ReactNode;
  folderSub?: (f: Folder) => React.ReactNode;
  folderColumns: ColumnDef<Folder>[];
  fileMeta: (f: FileItem) => React.ReactNode;
  fileStatus?: (f: FileItem) => React.ReactNode;
  fileCorner?: (f: FileItem) => React.ReactNode;
  fileSub?: (f: FileItem) => React.ReactNode;
  fileColumns: ColumnDef<FileItem>[];
  thumbnail: (f: FileItem) => React.ReactNode;
  emptyFiles?: React.ReactNode;
}

/** Folders section then files section, as cards or as tables. */
export function ItemsView(p: ItemsViewProps) {
  const { selection, dnd, getItemProps } = p.explorer;

  const folderEntries = p.folders.map((f) => ({ key: entryKey("folder", f.id), kind: "folder" as const, id: f.id, name: f.name }));
  const fileEntries = p.files.map((f) => ({ key: entryKey("file", f.id), kind: "file" as const, id: f.id, name: f.originalName }));

  const toggleAll = (keys: string[], checked: boolean) => {
    const next = new Set(selection.keys);
    keys.forEach((k) => (checked ? next.add(k) : next.delete(k)));
    selection.set(next);
  };

  const folderSection = p.folders.length > 0 && (
    <section>
      <SectionHeader title={p.folderTitle} count={p.folders.length} action={p.folderAction} />
      {p.view === "grid" ? (
        <ItemGrid kind="folders" label={p.folderTitle}>
          {p.folders.map((folder, i) => {
            const entry = folderEntries[i];
            return (
              <FolderCard
                key={folder.id}
                name={folder.name}
                meta={p.folderMeta(folder)}
                badge={p.folderBadge?.(folder)}
                selected={selection.has(entry.key)}
                dropActive={dnd.overTarget === folder.id}
                itemProps={getItemProps(entry)}
                onToggle={() => selection.toggle(entry.key)}
              />
            );
          })}
        </ItemGrid>
      ) : (
        <ItemTable
          label={p.folderTitle}
          columns={[{ label: "Nama" }, ...p.folderColumns]}
          allSelected={folderEntries.every((e) => selection.has(e.key))}
          onToggleAll={(c) => toggleAll(folderEntries.map((e) => e.key), c)}
        >
          {p.folders.map((folder, i) => {
            const entry = folderEntries[i];
            return (
              <ItemRow
                key={folder.id}
                name={folder.name}
                selected={selection.has(entry.key)}
                dropActive={dnd.overTarget === folder.id}
                itemProps={getItemProps(entry)}
                onToggle={() => selection.toggle(entry.key)}
              >
                <NameCell icon={<FolderGlyph className="w-4 h-4" />} name={folder.name} sub={p.folderSub?.(folder)} badge={p.folderBadge?.(folder)} />
                {p.folderColumns.map((c) => (
                  <Cell key={c.label} className={c.className}>
                    {c.render(folder)}
                  </Cell>
                ))}
              </ItemRow>
            );
          })}
        </ItemTable>
      )}
    </section>
  );

  const fileSection = p.showFiles && (
    <section>
      <SectionHeader title="Berkas" count={p.files.length} action={p.fileHeaderExtra} />
      {p.files.length === 0 ? (
        p.emptyFiles
      ) : p.view === "grid" ? (
        <ItemGrid kind="files" label="Berkas">
          {p.files.map((file, i) => {
            const entry = fileEntries[i];
            return (
              <FileCard
                key={file.id}
                name={file.originalName}
                thumbnail={p.thumbnail(file)}
                meta={p.fileMeta(file)}
                status={p.fileStatus?.(file)}
                corner={p.fileCorner?.(file)}
                selected={selection.has(entry.key)}
                itemProps={getItemProps(entry)}
                onToggle={() => selection.toggle(entry.key)}
              />
            );
          })}
        </ItemGrid>
      ) : (
        <ItemTable
          label="Berkas"
          columns={[{ label: "Nama" }, ...p.fileColumns]}
          allSelected={fileEntries.every((e) => selection.has(e.key))}
          onToggleAll={(c) => toggleAll(fileEntries.map((e) => e.key), c)}
        >
          {p.files.map((file, i) => {
            const entry = fileEntries[i];
            return (
              <ItemRow
                key={file.id}
                name={file.originalName}
                selected={selection.has(entry.key)}
                itemProps={getItemProps(entry)}
                onToggle={() => selection.toggle(entry.key)}
              >
                <NameCell
                  icon={<FileTypeIcon mimeType={file.mimeType} name={file.originalName} className="w-4 h-4" />}
                  name={file.originalName}
                  sub={p.fileSub?.(file)}
                  badge={p.fileCorner?.(file)}
                />
                {p.fileColumns.map((c) => (
                  <Cell key={c.label} className={c.className}>
                    {c.render(file)}
                  </Cell>
                ))}
              </ItemRow>
            );
          })}
        </ItemTable>
      )}
    </section>
  );

  return (
    <div className="space-y-8">
      {folderSection}
      {fileSection}
    </div>
  );
}

/** Explorer entries in display order (folders first) for selection and range-select. */
export function toEntries(folders: Folder[], files: FileItem[]) {
  return [
    ...folders.map((f) => ({ key: entryKey("folder", f.id), kind: "folder" as const, id: f.id, name: f.name })),
    ...files.map((f) => ({ key: entryKey("file", f.id), kind: "file" as const, id: f.id, name: f.originalName })),
  ];
}
