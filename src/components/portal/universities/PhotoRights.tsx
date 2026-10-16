"use client";

import { useEffect, type ReactNode, type SyntheticEvent } from "react";

import type { PortalStrings } from "@/lib/portal/i18n";

/**
 * Тихая кнопка «©» на фото (план 4.4, контракт 2.5): по нажатию автор,
 * источник и лицензия фото места или «Фото: <вуз>, официальный сайт» у
 * официальных медиа вуза. Строки лицензии под карточкой нет (приёмка
 * 7.6.5), но атрибуция CC BY и CC BY-SA остаётся рядом с самим фото на
 * каждом экране: у фото мест источник всегда ссылкой на страницу файла
 * (review S3 веба, F13; CC BY-SA 4.0, раздел 3(a)(1)(A)(v)).
 *
 * Основа `<details>`: открывается мышью, касанием и с клавиатуры ещё до
 * загрузки скрипта. Скрипт добавляет (N3): Escape и нажатие вне панели
 * закрывают её, открыта всегда только одна панель на странице.
 */

export type PhotoSource = Readonly<{ name: string; url: string }>;

export type PhotoCredit =
  | Readonly<{
      kind: "author";
      author: string;
      authorUrl: string | null;
      license: string;
      licenseUrl: string | null;
      /** Страница файла у фото мест; у фото вуза с открытой лицензией автор уже ведёт на неё. */
      source: PhotoSource | null;
    }>
  | Readonly<{ kind: "official"; sourceUrl: string }>;

export type PhotoRightsStrings = Pick<
  PortalStrings<"universities">,
  "photoRights" | "photoCredit" | "photoCreditSource" | "photoCreditOfficial" | "newTab"
>;

function External({ href, children, newTab }: { href: string | null; children: ReactNode; newTab: string }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="pt-sr-only"> {newTab}</span>
    </a>
  );
}

/** Шаблон словаря с местами `{имя}` и готовыми узлами на их месте. */
function fill(template: string, slots: Readonly<Record<string, ReactNode>>): ReactNode[] {
  return template.split(/(\{[a-z]+\})/u).map((part, index) => {
    const slot = /^\{([a-z]+)\}$/u.exec(part)?.[1];
    return slot !== undefined && Object.hasOwn(slots, slot)
      ? <span key={index}>{slots[slot]}</span>
      : part;
  });
}

const OPEN_PANELS = "details.pt-photo-rights[open]";
let documentListeners = false;

/**
 * Один набор слушателей на документ (ставится при первой кнопке «©» и живёт
 * со страницей): нажатие вне открытой панели и Escape её закрывают. Слушатели
 * смотрят на атрибут `open` в момент события, поэтому даже самое быстрое
 * нажатие сразу после открытия закрывает панель.
 */
function listenOnDocument(): void {
  if (documentListeners) return;
  documentListeners = true;
  document.addEventListener("pointerdown", (event) => {
    for (const details of document.querySelectorAll<HTMLDetailsElement>(OPEN_PANELS)) {
      if (!(event.target instanceof Node) || !details.contains(event.target)) details.open = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const details of document.querySelectorAll<HTMLDetailsElement>(OPEN_PANELS)) {
      const focusInside = details.contains(document.activeElement);
      details.open = false;
      if (focusInside) details.querySelector<HTMLElement>("summary")?.focus();
    }
  });
}

/** Открылась панель (мышью или с клавиатуры): остальные закрываются. */
function closeOthers(event: SyntheticEvent<HTMLDetailsElement>): void {
  const opened = event.currentTarget;
  if (!opened.open) return;
  for (const details of document.querySelectorAll<HTMLDetailsElement>(OPEN_PANELS)) {
    if (details !== opened) details.open = false;
  }
}

export function PhotoRights({
  credit,
  universityName,
  strings,
  placement,
}: {
  credit: PhotoCredit;
  /** Название вуза для «Фото: <вуз>, официальный сайт». */
  universityName?: string;
  strings: PhotoRightsStrings;
  /** Угол фото: сверху у мест (снизу на них текст), снизу у вузов (сверху сердечко). */
  placement: "top" | "bottom";
}) {
  useEffect(listenOnDocument, []);

  const link = (href: string | null, label: ReactNode) => <External href={href} newTab={strings.newTab}>{label}</External>;
  const text = credit.kind === "official"
    ? fill(strings.photoCreditOfficial, { university: link(credit.sourceUrl, universityName ?? "") })
    : fill(credit.source === null ? strings.photoCredit : strings.photoCreditSource, {
        author: link(credit.authorUrl, credit.author),
        source: credit.source === null ? null : link(credit.source.url, credit.source.name),
        license: link(credit.licenseUrl, credit.license),
      });
  return (
    <details className={`pt-photo-rights pt-photo-rights-${placement}`} onToggle={closeOthers}>
      <summary className="pt-photo-rights-btn" aria-label={strings.photoRights} title={strings.photoRights}>
        <span aria-hidden="true">©</span>
      </summary>
      <p className="pt-photo-rights-text">{text}</p>
    </details>
  );
}
