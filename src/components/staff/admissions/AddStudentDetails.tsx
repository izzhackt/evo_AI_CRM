"use client";

import { UserRoundPlusIcon } from "lucide-react";
import { Fragment, useId, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import {
  ADMISSIONS_DIRECT_PARENT_RELATIONS,
  EMPTY_ADMISSIONS_DIRECT_DRAFT,
  type AdmissionsDirectDraft,
} from "@/lib/admissions-direct-student-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

export type AddStudentSection = "student" | "parent" | "route" | "study" | "money" | "note";

/** Часть строки свёрнутого раскрытия. `preset` — значение по умолчанию, его не вводили: оно приглушено. */
export type SummaryPart = Readonly<{ text: string; preset?: boolean }>;

/** Внутренний радиус карточки: подсветка крайней строки не выходит за скругление рамки. */
const INNER_TOP = "rounded-t-[calc(var(--radius-card)-1px)]";
const INNER_BOTTOM = "rounded-b-[calc(var(--radius-card)-1px)]";

/**
 * Раскрытие формы: строка 52 px во всю ширину карточки — название, в свёрнутом виде одна строка того,
 * что уже заполнено (пустое раскрытие — только название), и шеврон. Поля свёрнутого раскрытия остаются в
 * разметке (`hidden`): значения и id живут, фокус на них не попадает. Ошибка внутри свёрнутого
 * раскрытия видна в его строке.
 */
export function DetailsSection({ name, title, summary, invalid, open, first, last, onToggle, children }: Readonly<{
  name: AddStudentSection;
  title: string;
  summary: readonly SummaryPart[];
  invalid: boolean;
  open: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  children: ReactNode;
}>) {
  const id = useId();
  const titleId = `${id}-title`;
  const panelId = `${id}-panel`;
  const corners = `${first ? INNER_TOP : ""} ${last && !open ? INNER_BOTTOM : ""}`;
  return (
    <div data-add-section={name}>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle}
        className={`flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-start enabled:hover:bg-surface-2 sm:px-5 ${corners}`}>
        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-4">
          <span id={titleId} className="shrink-0 t-item text-fg">{title}</span>
          {open ? null : <SectionSummary parts={summary} invalid={invalid} />}
        </span>
        <Icon name="chevron-down" size={18}
          className={`shrink-0 text-fg-3 transition-transform duration-150 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={panelId} role="group" aria-labelledby={titleId} hidden={!open}
        className="px-4 pb-5 animate-in fade-in slide-in-from-top-1 duration-150 ease-out motion-reduce:animate-none sm:px-5">
        <div className="grid gap-4 sm:grid-cols-2">{children}</div>
      </div>
    </div>
  );
}

function SectionSummary({ parts, invalid }: Readonly<{ parts: readonly SummaryPart[]; invalid: boolean }>) {
  const place = "min-w-0 t-body-compact sm:ms-auto";
  if (invalid) {
    return (
      <span className={`${place} flex items-center gap-1.5 text-danger`}>
        <Icon name="alert" size={14} className="shrink-0" />
        Есть ошибка
      </span>
    );
  }
  // Тёмное — введённое; приглушённое — значение по умолчанию и точки между частями: по списку сразу
  // видно, где уже есть данные. Пустое раскрытие ничего не пишет: «не заполнено» во всех строках
  // одинаково и ничего не сообщает (CLAUDE.md, «Что нельзя выводить на экран»).
  if (parts.length === 0) return null;
  return (
    <span className={`${place} truncate text-fg sm:text-end`}>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <span className="text-fg-3"> · </span> : null}
          <span className={part.preset ? "text-fg-3" : undefined}>{part.text}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** Круг шапки: инициалы студента, как только их набрали; до этого — знак «новый человек». */
export function DraftAvatar({ firstName, lastName }: Readonly<{ firstName: string; lastName: string }>) {
  const initials = [firstName, lastName].map((part) => Array.from(part.trim())[0] ?? "").join("").toLocaleUpperCase("ru-RU");
  return (
    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 t-item text-fg-2">
      {initials || <UserRoundPlusIcon size={20} strokeWidth={1.8} />}
    </span>
  );
}

/** Введённые значения строки раскрытия: пустые части выпадают. */
const typed = (...values: readonly (string | null | undefined | false)[]): SummaryPart[] =>
  values.map((value) => (value || "").trim()).filter(Boolean).map((text) => ({ text }));

/** «2008-03-12» → «12.03.2008». */
const dotted = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/u.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso);

function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  const ones = n % 10;
  if (ones === 1 && tens !== 11) return one;
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}

const ageText = (age: string) => {
  const value = age.trim();
  return /^\d{1,2}$/u.test(value) ? `${Number(value)} ${plural(Number(value), "год", "года", "лет")}` : value;
};

const language = (name: string, without: string, level: string) => (level === "" ? null : level === "Нет" ? without : `${name} ${level}`);

/** Подпись к стоимости, которую подставила форма (Китай) и ещё не изменили руками. */
const COST_DEFAULT_NOTE = "по умолчанию для Китая";

/**
 * Одна строка свёрнутого раскрытия: что в нём уже заполнено, через «·». Пусто — ничего.
 * Этап «Новые» стоит по умолчанию, его не вводили: он приглушён, пока этап не сменили. Стоимость,
 * подставленная для Китая, — уже значение дела, она тёмная; пока её не изменили (`costPrefilled`), рядом
 * приглушённо сказано «по умолчанию для Китая»: раскрытие свёрнуто, а с миграцией 378 такая стоимость заменяет
 * ту, что продажи записали на забранном лиде (ревью #1614). Набранная руками стоимость — без подписи.
 */
export function sectionSummary(section: AddStudentSection, draft: AdmissionsDirectDraft, costPrefilled = false): readonly SummaryPart[] {
  switch (section) {
    case "student":
      return typed(draft.email, draft.birthDate ? dotted(draft.birthDate) : ageText(draft.age));
    case "parent":
      return typed(
        Object.entries(ADMISSIONS_DIRECT_PARENT_RELATIONS).find(([key]) => key === draft.parentRelation)?.[1],
        `${draft.parentFirstName.trim()} ${draft.parentLastName.trim()}`,
        draft.parentPhone,
      );
    case "route":
      return typed(draft.degree, draft.program, draft.intake);
    case "study":
      return typed(
        draft.educationCurrent,
        language("английский", "без английского", draft.english),
        language("китайский", "без китайского", draft.chinese),
      );
    case "money": {
      const paid = draft.payments.length;
      const stage = admissionsPipelineStage(draft.stage);
      const cost = draft.costAmount.trim();
      return [
        ...(stage ? [{ text: stage, preset: draft.stage === EMPTY_ADMISSIONS_DIRECT_DRAFT.stage }] : []),
        ...typed(cost && `${cost} ${draft.costCurrency}`),
        ...(cost && costPrefilled ? [{ text: COST_DEFAULT_NOTE, preset: true }] : []),
        ...typed(
          draft.signedOn && `договор ${dotted(draft.signedOn)}`,
          paid > 0 && `${paid} ${plural(paid, "оплата", "оплаты", "оплат")}`,
        ),
      ];
    }
    case "note":
      return typed(draft.note.trim().split(/\r?\n/u)[0]);
  }
}
