import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Landmark,
  Languages,
  ListChecks,
  MessagesSquare,
  NotebookPen,
  Search,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * Общие части карточек «Главной» (08.11.2026, по образцу пользователя): шапка «заголовок слева, переход справа» и
 * пустое состояние «значок в круге, заголовок, одна строка, кнопка». Каждая карточка рисует их одинаково.
 */

// Значки — тот же набор Lucide, что у пунктов меню кабинета (08.11.2026), чтобы раздел и его пустое состояние совпадали.
const ICONS = {
  // Что сделать сейчас: планшет с отметкой.
  todo: ClipboardCheck,
  universities: Landmark,
  calendar: CalendarDays,
  // Что нового и чат: пузыри диалога, как у «Входящих».
  news: MessagesSquare,
  documents: FileText,
  payments: Wallet,
  professions: BriefcaseBusiness,
  english: Languages,
  csca: NotebookPen,
  tests: ListChecks,
  search: Search,
  bell: Bell,
} as const satisfies Record<string, LucideIcon>;

export type HomeIconName = keyof typeof ICONS;

export function HomeIcon({ name }: Readonly<{ name: HomeIconName }>) {
  const Icon = ICONS[name];
  return <Icon size={20} strokeWidth={1.75} aria-hidden="true" focusable="false" />;
}

/** Шапка карточки: заголовок и число, если оно больше нуля (ноль рядом с пустым состоянием ничего не сообщает). */
export function HomeCardHead({ id, title, count = null, action = null }: Readonly<{
  id: string;
  title: string;
  count?: number | null;
  action?: ReactNode;
}>) {
  return (
    <header className="pt-home-head">
      <h2 id={id} className="pt-home-heading">
        {title}
        {count ? <span className="pt-count">{count}</span> : null}
      </h2>
      {action}
    </header>
  );
}

/**
 * Значок пустого состояния: красноватый круг с красным значком (08.11.2026, пользователь: «давай сделаем эти значки
 * красноватыми как в акылмане», затем «тут тоже значок поставь» и «да, везде»). Один на весь кабинет.
 */
export function EmptyIcon({ name }: Readonly<{ name: HomeIconName }>) {
  return <span className="pt-home-empty-icon pt-empty-icon"><HomeIcon name={name} /></span>;
}

/** Пустое состояние карточки: что здесь будет и, если есть, что сделать. */
export function HomeEmpty({ icon, title, body = null, action = null }: Readonly<{
  icon: HomeIconName;
  title: string;
  body?: string | null;
  action?: ReactNode;
}>) {
  return (
    <div className="pt-home-empty">
      <span className="pt-home-empty-icon"><HomeIcon name={icon} /></span>
      <p className="pt-home-empty-title">{title}</p>
      {body ? <p className="pt-home-empty-body">{body}</p> : null}
      {action ? <div className="pt-home-empty-action">{action}</div> : null}
    </div>
  );
}
