"use client";

import Link from "next/link";

import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";

import { ProgressBar } from "../blocks/ProgressBar";
import { studentsRowMeta } from "../students/StudentsQueueTable";
import { docsWaiting, studentsCaseHref, studentsDocsCell, type DocsWaiting, type StudentsDocsPart, type StudentsDocsView } from "../students/students-queue-view";

const TONE: Readonly<Record<StudentsDocsPart["tone"], string>> = { default: "text-fg", danger: "text-danger", warn: "text-warn", muted: "text-fg-2" };

function Parts({ parts, strong }: Readonly<{ parts: readonly StudentsDocsPart[]; strong: boolean }>) {
  return parts.map((part, index) => (
    <span key={part.key}>
      {index > 0 ? <span className="text-fg-3"> · </span> : null}
      <span className={`inline-block ${strong || part.tone === "warn" || part.tone === "danger" ? "font-medium" : ""} ${TONE[part.tone]}`}>{part.text}</span>
    </span>
  ));
}

/** «Сколько ждёт»: «сегодня» или «ждёт 3 дн» (с двух дней — предупреждением); день загрузки — в подсказке. */
export function WaitingWord({ waiting }: Readonly<{ waiting: DocsWaiting }>) {
  return <time dateTime={waiting.dateTime} title={`Загружен ${waiting.day}`} className={waiting.warn ? "font-medium text-warn" : "text-fg-2"}>{waiting.word}</time>;
}

/**
 * Ячейка «Документы» дела: число, которое определяет вкладку («2 на проверке»), полоса «N из M принято» из прочитанных
 * чисел чек-листа и остальные слова. На «Документах дела» за числом — сколько ждёт самый давний документ. Нет права — так и сказано.
 */
export function DocumentsCell({ row, view, today }: Readonly<{ row: StudentCaseQueueRow; view: StudentsDocsView; today: string }>) {
  const cell = studentsDocsCell(view, row.documents);
  if (!cell) return <span className="t-body-compact text-fg-3">Нет доступа к документам</span>;
  const words = cell.lead.filter((part) => part.key !== "summary");
  const others = cell.rest.filter((part) => part.key !== "summary");
  const summary = [...cell.lead, ...cell.rest].find((part) => part.key === "summary");
  const waiting = view === "review" ? docsWaiting(row.documents?.oldestSubmittedAt, today) : null;
  return (
    <span className="block min-w-0 space-y-1 text-start">
      {words.length ? <span className="block t-item"><Parts parts={words} strong />{waiting ? <> <span className="font-normal text-fg-3">·</span> <WaitingWord waiting={waiting} /></> : null}</span> : null}
      <ProgressBar done={row.documents?.approved} total={row.documents?.total} word="принято" fallback={summary ? <span className="block text-fg">{summary.text}</span> : null} />
      {others.length ? <span className="block t-body-compact"><Parts parts={others} strong={false} /></span> : null}
    </span>
  );
}

/** Студент и «страна · уровень»; имя — ссылка на документы дела (область — вся ячейка). */
export function DocsStudentCell({ row, href }: Readonly<{ row: StudentCaseQueueRow; href: string }>) {
  const meta = studentsRowMeta(row);
  return (
    <div data-queue-row={row.studentCaseId} data-testid="v3-student-case-row" data-student-case-id={row.studentCaseId} className="relative z-0 min-w-0 py-0.5">
      <Link href={href} data-queue-open="" title={row.studentDisplayName} aria-label={`Открыть документы: ${row.studentDisplayName}`}
        className="line-clamp-2 break-words py-0.5 t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline">{row.studentDisplayName}</Link>
      <p className="truncate t-meta text-fg-2" title={meta}>{meta}</p>
    </div>
  );
}

export function CuratorName({ name }: Readonly<{ name: string | null }>) {
  return name ? <span className="block truncate t-body-compact text-fg" title={name}>{name}</span> : <span className="t-body-compact text-fg-3">не назначен</span>;
}

/** «⋯» строки: прежние «Анкета и формы» и «Пакет ZIP» (их состояний в строке очереди нет). */
export function DocsRowMenu({ row, returnTo }: Readonly<{ row: StudentCaseQueueRow; returnTo: string }>) {
  const anketa = studentsCaseHref(row.studentCaseId, { docs: true, tab: "anketa", returnTo });
  const packet = `${studentsCaseHref(row.studentCaseId, { docs: true, tab: "route", returnTo })}&panel=packets#partner-packets`;
  return (
    <div className="relative z-10 flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Ещё по документам: ${row.studentDisplayName}`}><Icon name="more-horizontal" size={20} /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem asChild><Link href={anketa}>Анкета и формы</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href={packet}>Пакет ZIP</Link></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
