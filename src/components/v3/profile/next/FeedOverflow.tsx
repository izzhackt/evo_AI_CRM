"use client";

import { useRef, useState } from "react";

import { DetailSheet } from "@/components/kit/DetailSheet";
import { Button } from "@/components/ui/button";

/**
 * Остальные строки ленты - в выезжающей панели: на странице видны последние, старое не удлиняет карточку
 * (CLAUDE.md, «Плотность»). Строки приходят готовыми с сервера (те же `FeedRow`, что в ленте); панель их
 * не перечитывает и ничего не пишет. Ссылка строки на место этой же страницы (`#case-facts`, `#case-header`)
 * закрывает панель: пока она открыта, цель за подложкой скрыта и переход ничего не показал бы. Сам переход
 * по адресу делает браузер; фокус при этом не возвращается на кнопку «Ещё N» - иначе страница прокрутилась бы
 * назад к ней.
 */
export function FeedOverflow({ count, title, children }: Readonly<{ count: number; title: string; children: React.ReactNode }>) {
  const [open, setOpen] = useState(false);
  const toAnchor = useRef(false);
  return (
    <DetailSheet
      title={title}
      open={open}
      onOpenChange={(next) => {
        if (next) toAnchor.current = false;
        setOpen(next);
      }}
      onCloseAutoFocus={(event) => {
        if (!toAnchor.current) return;
        toAnchor.current = false;
        event.preventDefault();
      }}
      trigger={<Button variant="outline" className="w-fit" aria-label={`Ещё ${count} в ленте`} data-testid="v3-feed-overflow">Ещё {count}</Button>}
    >
      <ol
        className="divide-y divide-border"
        data-testid="v3-feed-overflow-items"
        onClick={(event) => {
          if (!(event.target instanceof Element) || !event.target.closest('a[href^="#"]')) return;
          toAnchor.current = true;
          setOpen(false);
        }}
      >{children}</ol>
    </DetailSheet>
  );
}
