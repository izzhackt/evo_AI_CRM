import type { ReactNode } from "react";

import { admissionsPipelineStage } from "@/lib/v3/wording";

import type { CaseClosure } from "@/lib/platform-closure-contract";

import { isNextLook, type V3Look } from "../blocks/look";
import { StageTrack } from "../blocks/StageTrack";
import { Pill } from "../Pill";
import { ClosedLine } from "../closure/Closure";
import type { NextStepAccess } from "../students/students-queue-view";
import { AssignCaseCuratorForm } from "./AssignCaseCuratorForm";
import { CaseNextStep } from "./CaseNextStep";
import type { CaseWorkRead } from "./case-work-view";

/** Факт шапки: подпись данных над значением; соседей разделяет волосяная линия (как у Lead 360). */
function Fact({ term, wide = false, children }: Readonly<{ term: string; wide?: boolean; children: ReactNode }>) {
  return (
    <div className={`min-w-0 border-border py-2 sm:border-s sm:px-4 sm:first:border-s-0 sm:first:ps-0 ${wide ? "sm:min-w-[16rem] sm:flex-1" : ""}`}>
      <dt className="t-caption text-fg-2">{term}</dt>
      <dd className="mt-0.5 min-w-0 t-body-compact text-fg">{children}</dd>
    </div>
  );
}

export type CaseHeaderInput = Readonly<{
  studentCaseId: string;
  state: "pending" | "active" | "closed";
  /** Шаг из самого дела — когда строки очереди нет. */
  fallbackStep: string | null;
  financeStop: string | null;
  work: CaseWorkRead;
  stepAccess: NextStepAccess;
  stepRequestId: string;
  /** Назначение куратора делу, которое его ждёт (`case.curator.assign`, решение B 248). */
  coverage: boolean;
  curators: readonly Readonly<{ membershipId: string; displayName: string }>[];
  assignCuratorRequestId: string;
  /** Закрытие дела (246): исход, дата и «Вернуть в работу»; null — не прочитано. */
  closure?: CaseClosure | null;
  /** Новый облик (Э1.3–Э1.4): дорожка этапа, срок шага словом. */
  look?: V3Look;
}>;

/**
 * Шапка Student 360 (Э4, 27.09.2026) под именем (h1 страницы), на каждой
 * вкладке, как у Lead 360: «Этап» — дорожка этапа в новом облике, слово этапа
 * «Воронки поступления» — в обоих; «Что дальше» — шаг и срок с «Изменить»
 * (редактор «Быстрого просмотра» #1059); «Состояние» — закрытое дело,
 * «Ожидает начала», «ждёт принятия». Этап и срок берутся из строки очереди
 * 241 — без неё этапа нет, а не «Новые» по умолчанию. Направление, куратор и
 * остальные факты — в «Сведениях» «Обзора». Делу, которое ждёт куратора, тот,
 * кто назначает кураторов, назначает его здесь же прежней формой.
 */
export function CaseHeader(input: CaseHeaderInput) {
  const { work } = input;
  const next = isNextLook(input.look);
  const row = work.row;
  const stage = row ? admissionsPipelineStage(row.pipelineStage) : null;
  const awaiting = row?.attentionFlags.includes("awaiting_ack") ?? false;
  const closed = input.state === "closed" && input.closure?.state === "closed" ? input.closure : null;
  const stateWords = [
    input.state === "closed" && !closed ? "Дело закрыто" : null,
    input.state === "pending" ? "Ожидает начала" : null,
  ].filter((word): word is string => word !== null);
  return (
    <section className="flex flex-col gap-3" data-testid="v3-case-header" aria-label="Сведения дела">
      <dl className="grid grid-cols-1 border-y border-border sm:flex sm:flex-wrap">
        {stage ? <Fact term="Этап">{next && row ? <StageTrack kind="admissions" current={row.pipelineStage} closed={input.state === "closed"} /> : stage}</Fact> : null}
        <Fact term="Что дальше" wide>
          <CaseNextStep row={row} fallbackStep={input.fallbackStep} access={input.stepAccess}
            today={work.today} nowIso={work.nowIso} requestId={input.stepRequestId} look={input.look} />
        </Fact>
        {closed ? (
          <Fact term="Состояние" wide>
            <ClosedLine kind="case" subjectId={input.studentCaseId} expectedVersion={closed.admissionsVersion}
              reasonKey={closed.outcome} note={closed.note} closedAt={closed.closedAt}
              canReopen={closed.canChange} />
          </Fact>
        ) : stateWords.length || awaiting ? (
          <Fact term="Состояние">
            {stateWords.join(" · ")}
            {awaiting ? <span className="block font-medium text-warn">ждёт принятия</span> : null}
          </Fact>
        ) : null}
      </dl>
      {input.financeStop || work.deletionRequested ? (
        <p className="flex flex-wrap items-center gap-2">
          {input.financeStop ? <Pill tone="danger">финансовый стоп</Pill> : null}
          {work.deletionRequested ? <Pill tone="warn">запросил удаление аккаунта</Pill> : null}
        </p>
      ) : null}
      {input.coverage && work.needsCurator ? (
        <div className="border-b border-border pb-3">
          <AssignCaseCuratorForm studentCaseId={input.studentCaseId} curators={input.curators} requestId={input.assignCuratorRequestId} />
        </div>
      ) : null}
    </section>
  );
}
