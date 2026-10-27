"use client";

import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Input } from "@/components/ui/input";

import { searchHref } from "./link-filters-model";

/**
 * Поиск по всему списку (отбирает сервер): поле с Enter, как у прежней строки инструментов. Состояние остаётся в адресе:
 * вид и фильтры приходят скрытыми полями (`hidden`), страница и открытая запись при новом поиске сбрасываются. С `liveMs`
 * поиск идёт сам после паузы набора (каталог университетов). Без скрипта — обычная форма GET. Клавиша «/» ставит
 * фокус сюда (`data-queue-search`).
 */
export function ListSearch({ action, name = "q", value, placeholder, label, hidden, liveMs, maxLength = 100 }: Readonly<{
  action: string;
  name?: string;
  value: string;
  placeholder: string;
  label: string;
  hidden: Readonly<Record<string, string | null>>;
  liveMs?: number;
  maxLength?: number;
}>) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Текст управляемый: адрес от своего же поиска его не трогает, другой переход («Сбросить», «Назад») ставит текст из адреса.
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  const [sent, setSent] = useState<string | null>(null);
  if (value !== shown) {
    setShown(value);
    if (value !== sent) setText(value);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const go = (next: string, replace: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    setSent(next.trim());
    const href = searchHref(action, name, next, hidden);
    if (replace) router.replace(href, { scroll: false }); else router.push(href, { scroll: false });
  };
  return (
    <form action={action} method="get" role="search" aria-label={label} className="relative min-w-0 flex-1 basis-56"
      onSubmit={(event: FormEvent) => { event.preventDefault(); go(text, false); }}>
      {Object.entries(hidden).map(([key, hiddenValue]) => (hiddenValue ? <input key={key} type="hidden" name={key} value={hiddenValue} /> : null))}
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden="true" />
      <Input
        type="search"
        name={name}
        value={text}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="search"
        autoComplete="off"
        data-queue-search=""
        className="pl-9"
        onChange={(event) => {
          setText(event.target.value);
          if (liveMs === undefined) return;
          if (timer.current) clearTimeout(timer.current);
          if (event.target.value.trim() !== value) timer.current = setTimeout(() => go(event.target.value, true), liveMs);
        }}
      />
    </form>
  );
}
