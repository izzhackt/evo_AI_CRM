import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";

/**
 * Строки «Ленты» Lead 360 и Student 360 (Э4) — одна разметка на обе страницы.
 * У каждой строки одна и та же метка (кольцо 10 px) в одной колонке 16 px,
 * поэтому текст заметки, события и переписки начинается от одного края.
 * Метка стоит по центру первой строки своего текста (`h-[1lh]` в той же роли
 * шрифта; строка, которая начинается ссылкой, — по её цели 24 px) и только
 * рисунок — смысл строки несут её слова.
 */

/** Ссылка на объект события: тихое подчёркивание, заметное без наведения; цель — 24 px. */
export const FEED_LINK = "inline-flex min-h-6 items-center text-fg-2 underline decoration-border-strong underline-offset-4 hover:text-fg hover:decoration-fg";

function Mark({ type, link = false }: Readonly<{ type: "t-body" | "t-body-compact"; link?: boolean }>) {
  return (
    <span aria-hidden="true" className={`flex ${link ? "h-6" : "h-[1lh]"} w-4 shrink-0 items-center justify-center ${type}`}>
      <Icon name="circle" size={10} className="text-fg-3" />
    </span>
  );
}

/** Момент строки: дата и время моноширинными цифрами. */
function Moment({ at, label }: Readonly<{ at: string; label: string }>) {
  return <time dateTime={at} className="font-mono tabular-nums">{label}</time>;
}

type Focus = Readonly<{
  /**
   * Первая строка, открытая «Показать ещё»: фокус переходит на неё
   * (`FeedMore`), а не падает на страницу.
   */
  focusTarget?: boolean;
}>;

/** Заметка: текст целиком, под ним автор и момент. */
export function FeedNote({ body, author, at, label, focusTarget }: Readonly<{ body: string; author: string; at: string; label: string }> & Focus) {
  return (
    <li className="flex gap-x-2 py-3" data-feed="note" tabIndex={focusTarget ? -1 : undefined}>
      <Mark type="t-body" />
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words t-body text-fg">{body}</p>
        <p className="t-meta mt-1 text-fg-2">{author} · <Moment at={at} label={label} /></p>
      </div>
    </li>
  );
}

/** Событие: слова события (ссылкой на его объект, если он есть) и момент справа. */
export function FeedEvent({ text, at, label, href = null, focusTarget }: Readonly<{ text: string; at: string; label: string; href?: string | null }> & Focus) {
  return (
    <li className="flex min-h-11 gap-x-2 py-2.5" data-feed="event" tabIndex={focusTarget ? -1 : undefined}>
      <Mark type="t-body-compact" link={href !== null} />
      <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 t-body-compact text-fg-2">
        <span className="min-w-0 flex-1 break-words">
          {href ? <Link href={href} prefetch={false} className={FEED_LINK}>{text}</Link> : text}
        </span>
        <span className="t-meta"><Moment at={at} label={label} /></span>
      </p>
    </li>
  );
}

/** Последнее сообщение переписки: «Переписка» — ссылкой на неё, автор, момент; ниже — текст. */
export function FeedChat({ author, text, at, label, href, focusTarget }: Readonly<{ author: string; text: string; at: string; label: string; href: string }> & Focus) {
  return (
    <li className="flex gap-x-2 py-2.5" data-feed="chat" tabIndex={focusTarget ? -1 : undefined}>
      <Mark type="t-body-compact" link />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 t-body-compact text-fg-2">
          <span className="min-w-0 flex-1"><Link href={href} prefetch={false} className={FEED_LINK}>Переписка</Link> · {author}</span>
          <span className="t-meta"><Moment at={at} label={label} /></span>
        </p>
        <p className="mt-0.5 break-words t-body-compact text-fg">{text}</p>
      </div>
    </li>
  );
}

/** Строка-указатель (срез журнала): без метки, текст — от того же края, что у строк. */
export function FeedPointer({ children, focusTarget }: Readonly<{ children: ReactNode }> & Focus) {
  return (
    <li className="py-2.5 ps-6 t-body-compact text-fg-2" data-feed="older" tabIndex={focusTarget ? -1 : undefined}>
      {children}
    </li>
  );
}
