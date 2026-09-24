"use client";

import Link from "next/link";

import { Icon } from "@/components/icons";

import { useAnchoredPopover } from "../queue/useAnchoredPopover";

const MENU_ITEM = "flex min-h-11 w-full items-center rounded-nav px-3 text-start t-label text-fg-2 hover:bg-surface-2 hover:text-fg";

/**
 * «⋯» строки EVO Docs: прежние действия «Анкета и формы» и «Пакет ZIP».
 * Их состояний в строке очереди нет, поэтому они не колонки, а ссылки меню.
 * Окно — popover API в верхнем слое; выбор ссылки его закрывает.
 */
export function DocsRowMenu({ name, anketaHref, packetHref }: Readonly<{ name: string; anketaHref: string; packetHref: string }>) {
  const menu = useAnchoredPopover("end");
  const close = () => document.getElementById(menu.popoverId)?.hidePopover();
  return (
    <>
      <button
        id={menu.triggerId}
        type="button"
        popoverTarget={menu.popoverId}
        style={menu.triggerStyle}
        aria-label={`Ещё по документам: ${name}`}
        className="relative z-10 grid size-11 place-items-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg"
      >
        <Icon name="more-horizontal" size={20} />
      </button>
      <div
        id={menu.popoverId}
        popover="auto"
        style={menu.popoverStyle}
        role="group"
        aria-label={`Ещё по документам: ${name}`}
        className="v3-anchored v3-anchored-end w-56 rounded-ctl border border-border bg-surface p-1 text-fg shadow-evo-lg"
      >
        <Link href={anketaHref} onClick={close} className={MENU_ITEM}>Анкета и формы</Link>
        <Link href={packetHref} onClick={close} className={MENU_ITEM}>Пакет ZIP</Link>
      </div>
    </>
  );
}
