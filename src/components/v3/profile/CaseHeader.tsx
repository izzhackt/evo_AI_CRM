import Link from "next/link";
import type { ReactNode } from "react";

import type { AdmissionsDirection } from "@/lib/platform-admissions-playbook-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

import { Initials } from "../blocks/Initials";
import { isNextLook, type V3Look } from "../blocks/look";
import { StageTrack } from "../blocks/StageTrack";
import { Pill } from "../Pill";
import type { NextStepAccess } from "../students/students-queue-view";
import { AssignCaseCuratorForm } from "./AssignCaseCuratorForm";
import { CaseNextStep } from "./CaseNextStep";
import { DIRECTION_LABELS } from "./admissions-view";
import type { CaseWorkRead } from "./case-work-view";
import { COVERAGE_VIEW_HREF, coverageHref } from "./students-coverage-view";

/** Факт строки: подпись данных над значением; соседей разделяет волосяная линия. */
function Fact({ term, wide = false, children }: Readonly<{ term: string; wide?: boolean; children: ReactNode }>) {
  return (
    <div className={`min-w-0 border-border py-2 sm:border-s sm:px-4 sm:first:border-s-0 sm:first:ps-0 ${wide ? "col-span-2 sm:min-w-[16rem] sm:flex-1" : ""}`}>
      <dt className="t-caption text-fg-2">{term}</dt>
      <dd className="mt-0.5 min-w-0 t-body-compact text-fg">{children}</dd>
    </div>
  );
}

export type CaseHeaderInput = Readonly<{
  studentCaseId: string;
  state: "pending" | "active" | "closed";
  direction: AdmissionsDirection | null;
  curatorName: string | null;
  /** Шаг из самого дела — когда строки очереди нет. */
  fallbackStep: string | null;
  financeStop: string | null;
  work: CaseWorkRead;
  stepAccess: NextStepAccess;
  stepRequestId: string;
  /** Admin: «Нагрузка кураторов» и назначение куратора делу, которое его ждёт. */
  coverage: boolean;
  curators: readonly Readonly<{ membershipId: string; displayName: string }>[];
  assignCuratorRequestId: string;
  /** Новый облик (Э1.3–Э1.4): дорожка этапа, инициалы куратора, срок шага словом. */
  look?: V3Look;
}>;

/**
 * Строка фактов дела под именем (h1 страницы): направление · этап (слова
 * «Воронки поступления») · куратор · следующий шаг и срок. Видна на каждой
 * вкладке дела. Этап и срок берутся из строки очереди 241 — без неё этапа
 * нет, а не «Новые» по умолчанию.
 */
export function CaseHeader(input: CaseHeaderInput) {
  const { work } = input;
  const next = isNextLook(input.look);
  const row = work.row;
  const stage = row ? admissionsPipelineStage(row.pipelineStage) : null;
  const awaiting = row?.attentionFlags.includes("awaiting_ack") ?? false;
  const curatorId = row?.currentCuratorMembershipId ?? null;
  return (
    <section className="flex flex-col gap-3" data-testid="v3-case-header" aria-label="Сведения дела">
      <dl className="grid grid-cols-2 gap-x-4 border-y border-border sm:flex sm:flex-wrap sm:gap-x-0">
        <Fact term="Направление">{input.direction ? DIRECTION_LABELS[input.direction] : "Не выбрано"}</Fact>
        {stage ? <Fact term="Этап">{next && row ? <StageTrack kind="admissions" current={row.pipelineStage} closed={input.state === "closed"} /> : stage}</Fact> : null}
        <Fact term="Куратор">
          {(next && input.curatorName ? (
            <span className="inline-flex items-center gap-2"><Initials name={input.curatorName} decorative />{input.curatorName}</span>
          ) : input.curatorName) ?? (work.needsCurator ? <span className="font-medium text-danger">нужен куратор</span> : <span className="text-fg-2">не назначен</span>)}
          {awaiting ? <span className="block font-medium text-warn">ждёт принятия</span> : null}
          {input.coverage && !work.needsCurator ? (
            <Link href={curatorId ? coverageHref(curatorId, input.studentCaseId) : COVERAGE_VIEW_HREF}
              className="flex min-h-11 w-fit items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">
              Нагрузка кураторов
            </Link>
          ) : null}
        </Fact>
        {input.state !== "active" ? <Fact term="Состояние">{input.state === "closed" ? "Дело закрыто" : "Ожидает начала"}</Fact> : null}
        <Fact term="Следующий шаг" wide>
          <CaseNextStep row={row} fallbackStep={input.fallbackStep} access={input.stepAccess}
            today={work.today} nowIso={work.nowIso} requestId={input.stepRequestId} look={input.look} />
        </Fact>
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
