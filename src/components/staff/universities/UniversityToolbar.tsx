"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Icon } from "@/components/icons";

/**
 * Строка инструментов «Университетов» (Э6, 27.09.2026) — одна строка 44 px:
 * поиск ищет сам после короткой паузы и по Enter, «Страна» и «Уровень»
 * применяются при выборе (значение «Все страны» / «Китай» говорит, что
 * выбрано; подпись поля — для читалки), «Сбросить» — только когда что-то
 * выбрано. Всё состояние — в адресе (`q`, `country`, `level`; страница
 * сбрасывается). Без скрипта это обычная форма GET, и для неё остаётся «Найти».
 *
 * Все три поля управляемые и не пересоздаются при переходе: фокус остаётся
 * на поле, где его оставили (выбор «Страны» с клавиатуры не выбрасывает
 * фокус на страницу). Значения приходят из адреса: «Сбросить» или «Назад»
 * ставят их заново.
 */
export type UniversityToolbarOption = Readonly<{ value: string; label: string }>;

const LIVE_DELAY_MS = 400;
const CONTROL = "h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface t-body-compact text-fg hover:bg-surface-2";

export function UniversityToolbar({
  action,
  query,
  country,
  level,
  countries,
  levels,
}: Readonly<{
  action: string;
  query: string;
  country: string;
  level: string;
  countries: readonly UniversityToolbarOption[];
  levels: readonly UniversityToolbarOption[];
}>) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Поле поиска управляемое: адрес, пришедший от своей же живой отправки,
  // текст не трогает (иначе пропали бы буквы, набранные после паузы), а
  // другой переход — «Сбросить», «Назад» — ставит текст из адреса.
  const [text, setText] = useState(query);
  const [shown, setShown] = useState(query);
  const [sent, setSent] = useState<string | null>(null);
  if (query !== shown) {
    setShown(query);
    if (query !== sent) setText(query);
  }
  // «Страна» и «Уровень» — то же правило: своё значение сразу, адрес — источник правды после перехода.
  const [countryValue, setCountryValue] = useState(country);
  const [levelValue, setLevelValue] = useState(level);
  const [shownFilters, setShownFilters] = useState({ country, level });
  if (country !== shownFilters.country || level !== shownFilters.level) {
    setShownFilters({ country, level });
    setCountryValue(country);
    setLevelValue(level);
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const href = (next: Readonly<{ q?: string; country?: string; level?: string }>) => {
    const params = new URLSearchParams();
    const q = (next.q ?? text).trim();
    const nextCountry = next.country ?? countryValue;
    const nextLevel = next.level ?? levelValue;
    if (q) params.set("q", q);
    if (nextCountry) params.set("country", nextCountry);
    if (nextLevel) params.set("level", nextLevel);
    const tail = params.toString();
    return tail ? `${action}?${tail}` : action;
  };
  const search = (value: string, replace: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    setSent(value.trim());
    if (replace) router.replace(href({ q: value }), { scroll: false });
    else router.push(href({ q: value }), { scroll: false });
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    search(text, false);
  };
  const selected = Boolean(query || country || level);

  return (
    <form action={action} method="get" role="search" aria-label="Поиск университетов" onSubmit={onSubmit} data-testid="university-toolbar"
      className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-48 flex-1 basis-56 md:max-w-sm">
        <span className="t-label sr-only">Название университета</span>
        <Icon name="search" size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-3" />
        <input
          type="search"
          name="q"
          value={text}
          maxLength={100}
          placeholder="Найти университет"
          enterKeyHint="search"
          autoComplete="off"
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            if (timer.current) clearTimeout(timer.current);
            if (value.trim() !== query) timer.current = setTimeout(() => search(value, true), LIVE_DELAY_MS);
          }}
          className={`${CONTROL} ps-10 pe-3 placeholder:text-fg-3`}
        />
      </label>
      <label className="min-w-40 flex-1 basis-40 sm:max-w-56">
        <span className="t-label sr-only">Страна</span>
        <select name="country" value={countryValue} onChange={(event) => {
          setCountryValue(event.target.value);
          router.push(href({ country: event.target.value }), { scroll: false });
        }} className={`${CONTROL} px-3`}>
          <option value="">Все страны</option>
          {countries.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="min-w-40 flex-1 basis-40 sm:max-w-56">
        <span className="t-label sr-only">Уровень</span>
        <select name="level" value={levelValue} onChange={(event) => {
          setLevelValue(event.target.value);
          router.push(href({ level: event.target.value }), { scroll: false });
        }} className={`${CONTROL} px-3`}>
          <option value="">Все уровни</option>
          {levels.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {/* Без скрипта выбор не применяется сам: остаётся обычная отправка формы. */}
      <noscript>
        <button className="inline-flex h-11 items-center rounded-ctl border border-control-edge bg-surface px-4 t-label text-fg-2 hover:bg-surface-2">Найти</button>
      </noscript>
      {selected ? (
        <Link href={action} scroll={false} className="inline-flex min-h-11 items-center px-2 t-label text-fg-2 underline underline-offset-4 hover:text-fg">
          Сбросить
        </Link>
      ) : null}
    </form>
  );
}
