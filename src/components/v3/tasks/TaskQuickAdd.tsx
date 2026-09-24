"use client";

import { useRef, useState, type ComponentProps } from "react";

import { Icon } from "@/components/icons";

import { TaskComposerDialog } from "./TaskComposerDialog";

type ComposerProps = Omit<ComponentProps<typeof TaskComposerDialog>, "openIntent" | "hideTrigger" | "initialTitle" | "onClosed" | "triggerLabel" | "triggerClassName">;

/**
 * Тихая строка «Новая задача…» над списком и тот же диалог создания, что у
 * кнопки «Создать задачу» верхней панели. Enter открывает диалог с набранным
 * названием и сроком «Сегодня»; адрес (`?create=…&open=…`) открывает его так
 * же, как раньше. Своей красной кнопки у страницы нет.
 */
export function TaskQuickAdd({
  composer,
  urlIntent,
  showRow,
}: Readonly<{
  composer: ComposerProps;
  /** Намерение из адреса: `open` (глобальная кнопка) или `create`. */
  urlIntent: string | null;
  /** Строка видна, когда сотрудник может создавать задачи. */
  showRow: boolean;
}>) {
  const [local, setLocal] = useState<Readonly<{ key: string; title: string }> | null>(null);
  const [seenUrlIntent, setSeenUrlIntent] = useState(urlIntent);
  const inputRef = useRef<HTMLInputElement>(null);
  if (seenUrlIntent !== urlIntent) {
    setSeenUrlIntent(urlIntent);
    setLocal(null);
  }
  return (
    <>
      {showRow ? (
        <form
          aria-label="Новая задача"
          data-testid="task-quick-add"
          className="flex min-h-12 items-center gap-2 border-b border-border"
          onSubmit={(event) => {
            event.preventDefault();
            const input = inputRef.current;
            setLocal({ key: crypto.randomUUID(), title: input?.value ?? "" });
            if (input) input.value = "";
          }}
        >
          <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center text-fg-3"><Icon name="plus" size={20} /></span>
          <label className="min-w-0 flex-1">
            <span className="sr-only">Название новой задачи</span>
            <input
              ref={inputRef}
              name="quick_title"
              maxLength={1000}
              autoComplete="off"
              enterKeyHint="go"
              placeholder="Новая задача…"
              className="h-11 w-full min-w-0 rounded-ctl border border-transparent bg-transparent px-2 t-body text-fg placeholder:text-fg-3 hover:border-border focus-visible:border-accent focus-visible:bg-surface"
            />
          </label>
        </form>
      ) : null}
      <TaskComposerDialog
        {...composer}
        hideTrigger
        openIntent={local?.key ?? urlIntent}
        initialTitle={local?.title ?? ""}
        onClosed={() => inputRef.current?.focus()}
      />
    </>
  );
}
