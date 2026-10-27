"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";
import { KNOWLEDGE_AREA_NAMES, type KnowledgeArea, type KnowledgeItem } from "@/lib/knowledge-library-contract";

import type { KnowledgeDialog } from "./useKnowledgeActions";
import { folderPathLabel } from "./library-model";

const TITLES = { move: "Переместить", rename: "Переименовать", folder: "Новая папка", page: "Новая страница" } as const;
/** Кнопка, с которой окно открыли: туда возвращается фокус (меню закрылось раньше окна, и Radix вернул бы его в начало страницы). */
const OPENER = { move: "knowledge-move", rename: "knowledge-selection-menu", folder: "knowledge-create-menu", page: "knowledge-create-menu" } as const;

/** Окно «Новая папка / Новая страница / Переименовать / Переместить»: те же поля и тот же текст ошибки, что раньше. */
export function LibraryDialogs({ dialog, onClose, onSubmit, busy, error, name, onName, targetFolder, onTarget, area, folders, selected }: Readonly<{
  dialog: KnowledgeDialog;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  busy: boolean;
  error: string;
  name: string;
  onName: (value: string) => void;
  targetFolder: string;
  onTarget: (value: string) => void;
  area: KnowledgeArea;
  folders: readonly KnowledgeItem[];
  selected: ReadonlySet<string>;
}>) {
  const [shown, setShown] = useState(dialog);
  if (dialog && dialog !== shown) setShown(dialog);
  const byId = new Map(folders.map((folder) => [folder.id, folder] as const));
  const destinations = folders.filter((folder) => folder.area === area && !selected.has(folder.id))
    .map((folder) => ({ folder, label: folderPathLabel(folder, byId) })).sort((a, b) => a.label.localeCompare(b.label, "ru"));
  return (
    <Dialog open={dialog !== null} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent aria-describedby={undefined} data-testid="knowledge-dialog" onCloseAutoFocus={(event) => {
        event.preventDefault();
        const target = (shown ? document.querySelector<HTMLElement>(`[data-testid="${OPENER[shown]}"]`) : null) ?? document.querySelector<HTMLElement>('[aria-label="Поиск по базе знаний"]');
        target?.focus();
      }}>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader><DialogTitle>{dialog ? TITLES[dialog] : ""}</DialogTitle></DialogHeader>
          {dialog === "move" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="kb-target">Куда</Label>
              <NativeSelect id="kb-target" value={targetFolder} onChange={(event) => onTarget(event.target.value)}>
                <option value="">В корень: {KNOWLEDGE_AREA_NAMES[area]}</option>
                {destinations.map(({ folder, label }) => <option key={folder.id} value={folder.id}>{label}</option>)}
              </NativeSelect>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="kb-name">Название</Label>
              <Input id="kb-name" autoFocus required maxLength={240} value={name} onChange={(event) => onName(event.target.value)} />
            </div>
          )}
          {error && dialog ? <p role="alert" className="t-body-compact text-danger">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <button type="submit" className={QUEUE_CONFIRM} disabled={busy}>{busy ? "Сохраняется…" : "Сохранить"}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
