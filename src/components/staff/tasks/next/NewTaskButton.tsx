"use client";

import { useRef, useState, type ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { isStaffPreview } from "@/lib/platform-access";

import { TaskComposerDialog } from "../TaskComposerDialog";

type ComposerProps = Omit<ComponentProps<typeof TaskComposerDialog>, "openIntent" | "hideTrigger" | "initialTitle" | "onClosed" | "triggerLabel" | "triggerClassName">;

/**
 * «Новая задача» — кнопка шапки страницы и тот же единственный диалог создания, что открывали строка «Новая задача…»
 * и «Создать задачу» меню (`TaskComposerDialog`). Адрес (`?create=…&open=…`) открывает диалог так же, как раньше:
 * новое значение намерения открывает его снова. Красная кнопка здесь одна на страницу; без права создавать
 * кнопки нет, а диалог по адресу остаётся.
 */
export function NewTaskButton({ composer, urlIntent, showButton, label = "Новая задача", variant = "default" }: Readonly<{
  composer: ComposerProps;
  urlIntent: string | null;
  showButton: boolean;
  label?: string;
  variant?: "default" | "outline";
}>) {
  const button = useRef<HTMLButtonElement>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [seenUrlIntent, setSeenUrlIntent] = useState(urlIntent);
  if (seenUrlIntent !== urlIntent) {
    setSeenUrlIntent(urlIntent);
    setLocal(null);
  }
  // Диалог сам молчит без права создавать и в просмотре роли: кнопки тогда тоже нет.
  const available = (composer.staffAllowed || composer.caseAllowed) && !isStaffPreview(composer.actor);
  return (
    <>
      {showButton && available ? <Button ref={button} variant={variant} aria-haspopup="dialog" onClick={() => setLocal(crypto.randomUUID())}>{label}</Button> : null}
      <TaskComposerDialog {...composer} hideTrigger openIntent={local ?? urlIntent} onClosed={() => button.current?.focus()} />
    </>
  );
}
