"use client";

import { EllipsisIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { KnowledgeItem } from "@/lib/knowledge-library-contract";

import type { KnowledgeView } from "../KnowledgeTree";

/**
 * Что делать с выбранными материалами: в корзине — «Восстановить», в архиве — «Вернуть из архива»; «Переместить» и «В корзину»,
 * «Снять выбор»; редкое — в «⋯» (переименовать одно, привязать к делу, архивировать, выгрузить выбранное). Условия те же, что раньше.
 */
export function LibrarySelectionBar({ chosen, count, view, busy, assignReady, onMutate, onMove, onClear, onRename, onAssign, onExport }: Readonly<{
  chosen: readonly KnowledgeItem[];
  count: number;
  view: KnowledgeView;
  busy: boolean;
  assignReady: boolean;
  onMutate: (op: "trash" | "restore" | "archive" | "unarchive") => void;
  onMove: () => void;
  onClear: () => void;
  onRename: (item: KnowledgeItem) => void;
  onAssign: () => void;
  onExport: () => void;
}>) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface-2 px-3 py-2" data-testid="knowledge-selection">
      <span className="me-1 t-item text-fg">Выбрано: <span className="tabular-nums">{count}</span></span>
      {view === "trash" ? <Button variant="outline" disabled={busy} onClick={() => onMutate("restore")}>Восстановить</Button> : (
        <>
          {view === "archive" ? <Button variant="outline" disabled={busy} onClick={() => onMutate("unarchive")}>Вернуть из архива</Button> : null}
          <Button variant="outline" data-testid="knowledge-move" onClick={onMove}>Переместить</Button>
          <Button variant="outline" disabled={busy} onClick={() => onMutate("trash")}>В корзину</Button>
        </>
      )}
      <Button variant="ghost" onClick={onClear}>Снять выбор</Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Ещё действия с выбранным" data-testid="knowledge-selection-menu"><EllipsisIcon aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {view !== "trash" && count === 1 ? <DropdownMenuItem onSelect={() => onRename(chosen[0])}>Переименовать</DropdownMenuItem> : null}
          {view !== "trash" && chosen.every((item) => item.area === "clients" && !item.client_case_id && !item.archived_at)
            ? <DropdownMenuItem disabled={busy || !assignReady} onSelect={onAssign}>Привязать к делу</DropdownMenuItem> : null}
          {view !== "trash" && view !== "archive" ? <DropdownMenuItem disabled={busy} onSelect={() => onMutate("archive")}>Архивировать</DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={onExport}>Выгрузить выбранное</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
