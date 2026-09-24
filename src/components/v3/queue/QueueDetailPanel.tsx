"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import { Icon } from "@/components/icons";

import { modalOpen, openPopover, typingTarget } from "./useQueueKeyboard";

/** От этой ширины окна панель сдвигает список (сетка `1fr | 26rem`), уже — лежит поверх. */
export const QUEUE_PANEL_WIDE_QUERY = "(min-width: 1280px)";

/**
 * Правая панель подробностей очереди. Открытая запись живёт в адресе
 * (`closeHref` — тот же список без неё), поэтому Back и обновление работают.
 *
 * От 1280 px — обычный `<dialog open>` второй колонкой сетки: список виден и
 * доступен рядом. Уже — тот же `<dialog>` поднимается в модальный режим
 * (`showModal`): верхний слой, фон недоступен, Esc закрывает; на телефоне —
 * во весь экран с «← К задачам». Рядом со списком крестик стоит в углу, поэтому
 * заголовку записи нужен отступ справа (`xl:pe-10`). При открытии фокус
 * переходит на заголовок записи; при закрытии список возвращает его на строку
 * (`useQueueKeyboard`).
 */
export function QueueDetailPanel({
  closeHref,
  backLabel,
  headingId,
  children,
}: Readonly<{
  closeHref: string;
  /** «К задачам» — подпись возврата на узком экране. */
  backLabel: string;
  /**
   * id заголовка записи внутри `children`: он называет панель и получает фокус.
   * Заголовку нужен `tabIndex={-1}` и `data-queue-heading` — без рамки фокуса.
   */
  headingId: string;
  children: ReactNode;
}>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const media = window.matchMedia(QUEUE_PANEL_WIDE_QUERY);
    const arrange = () => {
      const modal = !media.matches;
      if (modal === dialog.matches(":modal")) return;
      dialog.close();
      if (modal) dialog.showModal();
      else dialog.show();
    };
    arrange();
    document.getElementById(headingId)?.focus({ preventScroll: true });
    media.addEventListener("change", arrange);
    return () => media.removeEventListener("change", arrange);
  }, [headingId]);

  const close = () => router.push(closeHref, { scroll: false });

  // Рядом со списком (не модально) Esc закрывает панель, если пользователь не
  // печатает и поверх нет меню или диалога; модальную закрывает её cancel.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || typingTarget(event.target) || openPopover() || modalOpen()) return;
      event.preventDefault();
      router.push(closeHref, { scroll: false });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, closeHref]);

  return (
    <dialog
      ref={dialogRef}
      open
      aria-labelledby={headingId}
      data-testid="queue-detail-panel"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto border-0 bg-surface p-0 text-fg backdrop:bg-black/40 md:start-auto md:w-[26rem] md:border-s md:border-border md:shadow-evo-lg xl:sticky xl:inset-auto xl:top-4 xl:z-auto xl:h-auto xl:max-h-[calc(100dvh-2rem)] xl:w-auto xl:rounded-card xl:border xl:shadow-none"
    >
      <div className="flex min-h-full flex-col">
        {/* Уже 1280 px — полоса «← К задачам»; рядом со списком — один крестик в углу. */}
        <div className="sticky top-0 z-10 flex min-h-14 items-center border-b border-border bg-surface px-2 xl:contents">
          <Link
            href={closeHref}
            scroll={false}
            data-testid="queue-detail-close"
            className="inline-flex min-h-11 items-center gap-2 rounded-nav px-2 t-label text-fg-2 hover:bg-surface-2 hover:text-fg xl:absolute xl:end-2 xl:top-2 xl:z-10 xl:w-11 xl:justify-center xl:px-0"
          >
            <Icon name="arrow-left" size={18} className="xl:hidden" />
            <span className="xl:hidden">{backLabel}</span>
            <span className="hidden xl:block xl:sr-only">Закрыть</span>
            <Icon name="x" size={18} className="hidden xl:block" />
          </Link>
        </div>
        <div className="flex-1 p-4">{children}</div>
      </div>
    </dialog>
  );
}
