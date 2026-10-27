"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useState } from "react";

import type { KnowledgeItem } from "@/lib/knowledge-library-contract";

import { command, configureKnowledgeCommands, knowledgeSourceKey, uploadKnowledgeFile } from "../client";
import type { KnowledgeData } from "./useKnowledgeData";

type UndoOp = "restore" | "unarchive";
export type KnowledgeDialog = "folder" | "page" | "rename" | "move" | null;

/**
 * Команды «Базы знаний» нового вида: в корзину / архив / вернуть с «Отменить», создать, переименовать, переместить, загрузить файлы и
 * папки. Те же команды (`expectedVersion`, `requestId` из `command`), тот же порядок и те же слова, что у прежней `KnowledgeLibrary`.
 */
export function useKnowledgeActions(data: KnowledgeData, commandScope: string) {
  useLayoutEffect(() => { configureKnowledgeCommands(commandScope); }, [commandScope]);
  const router = useRouter();
  const { area, parentId, folders, selected, rows, reload, setError, setSelected } = data;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [undo, setUndo] = useState<{ readonly op: UndoOp; readonly items: KnowledgeItem[]; readonly message: string } | null>(null);
  const [dialog, setDialog] = useState<KnowledgeDialog>(null);
  const [name, setName] = useState("");
  const [targetFolder, setTargetFolder] = useState("");
  const chosen = rows.filter((item) => selected.has(item.id));
  const parent = folders.find((folder) => folder.id === parentId);

  async function mutate(op: "trash" | "restore" | "archive" | "unarchive") {
    setBusy(true); setError(""); setUndo(null);
    try {
      const done: KnowledgeItem[] = [];
      for (const item of chosen) done.push(await command({ op, id: item.id, expectedVersion: item.version }));
      const message = op === "trash" ? "Перемещено в корзину" : op === "restore" ? "Восстановлено" : op === "archive" ? "Архивировано" : "Возвращено из архива";
      setStatus(message);
      // Отменить можно только то, что вернулось с новой версией: обратная команда проверяет её.
      if ((op === "trash" || op === "archive") && done.every((item) => item && typeof item.version === "number")) setUndo({ op: op === "trash" ? "restore" : "unarchive", items: done, message });
      reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Действие не выполнено."); reload(); }
    finally { setBusy(false); }
  }
  async function undoLast() {
    if (!undo) return;
    setBusy(true); setError("");
    try {
      for (const item of undo.items) await command({ op: undo.op, id: item.id, expectedVersion: item.version });
      setStatus(undo.op === "restore" ? "Восстановлено" : "Возвращено из архива"); setUndo(null); reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отменить."); reload(); }
    finally { setBusy(false); }
  }
  async function submitDialog(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (dialog === "folder" || dialog === "page") {
        const item = await command({ op: "create", area, parentId, kind: dialog, title: name.trim(), caseId: parent?.client_case_id ?? null });
        if (dialog === "page") router.push(data.href({ item: item.id }));
      } else if (dialog === "rename" && chosen[0]) await command({ op: "edit", id: chosen[0].id, expectedVersion: chosen[0].version, title: name.trim() });
      else if (dialog === "move") for (const item of chosen) await command({ op: "move", id: item.id, expectedVersion: item.version, parentId: targetFolder || null });
      setDialog(null); setName(""); reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Действие не выполнено."); }
    finally { setBusy(false); }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(""); setUndo(null);
    const folderCache = new Map<string, string>();
    try {
      for (const file of Array.from(files)) {
        let destination = parentId;
        const parts = (file.webkitRelativePath || file.name).split("/").slice(0, -1);
        let relative = "";
        for (const part of parts) {
          relative += `/${part}`;
          if (!folderCache.has(relative)) {
            const existing = folders.find((item) => item.area === area && item.parent_id === destination && item.title === part);
            const created: KnowledgeItem = existing ?? await command<KnowledgeItem>({ op: "create", kind: "folder", area, parentId: destination, title: part, sourceKey: knowledgeSourceKey(["folder", area, destination, part]), caseId: parent?.client_case_id ?? null });
            folderCache.set(relative, created.id);
          }
          destination = folderCache.get(relative)!;
        }
        await uploadKnowledgeFile(file, area, destination, (done, total) => setStatus(`${file.name} · ${total ? Math.round(done / total * 100) : 100}%`), parent?.client_case_id ?? null);
      }
      setStatus("Файлы загружены"); reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Загрузка не завершена. Выберите файлы повторно, чтобы продолжить."); reload(); }
    finally { setBusy(false); }
  }
  return {
    busy, status, undo, dialog, name, targetFolder, chosen, parent, setDialog, setName, setTargetFolder, setSelected,
    mutate, undoLast, submitDialog, upload,
    openDialog: (kind: "folder" | "page") => { setName(""); setDialog(kind); },
  };
}

export type KnowledgeActions = ReturnType<typeof useKnowledgeActions>;
