import Link from "next/link";

import { PortalDefinition, PortalEmptyState, PortalSection } from "./PortalPage";
import { PortalStatus } from "./PortalStatus";
import type { StudentPortalOverview } from "@/lib/v3/portal-source";
import {
  evoActionDueLabel,
  evoActionStatus,
  overviewStage,
  studentActionDueLabel,
} from "./presentation";

export function OverviewView({
  overview,
}: {
  overview: StudentPortalOverview | null;
}) {
  if (overview === null) {
    return (
      <PortalEmptyState
        title="План поступления пока не опубликован"
        description="Здесь появятся текущий этап, следующий шаг и контакт куратора, когда команда EVO закрепит их за вашим делом."
      />
    );
  }

  const stage = overviewStage(overview);
  const studentDueLabel = overview.studentAction
    ? studentActionDueLabel(overview.studentAction)
    : null;
  const evoDueLabel = overview.evoAction
    ? evoActionDueLabel(overview.evoAction)
    : null;
  const evoStatus = overview.evoAction
    ? evoActionStatus(overview.evoAction)
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
      <PortalSection
        title="Что сейчас"
        description="Актуальный этап и ближайшие действия по вашему поступлению."
      >
        <div className="grid gap-5 px-4 py-5 sm:px-5">
          <dl>
            <PortalDefinition term="Текущий этап">
              <PortalStatus label={stage.label} tone={stage.tone} />
            </PortalDefinition>
          </dl>

          <dl className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
            <PortalDefinition term="Что требуется от вас">
              {overview.studentAction ? (
                <span className="block">
                  <span className="block">
                    {overview.studentAction.kind === "upload_document"
                      ? "Загрузите документ"
                      : "Замените документ"}: {overview.studentAction.label}
                  </span>
                  {studentDueLabel ? (
                    <span className="mt-1 block text-xs font-normal text-fg-3">
                      Срок: {studentDueLabel}
                    </span>
                  ) : null}
                  <Link
                    href={`/portal/documents#document-${overview.studentAction.documentSlotId}`}
                    className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Открыть документ
                  </Link>
                </span>
              ) : (
                <span className="font-normal text-fg-3">
                  Нет документов, которые сейчас нужно загрузить или заменить.
                </span>
              )}
            </PortalDefinition>

            <PortalDefinition term="Что делает EVO">
              {overview.evoAction && evoStatus ? (
                <details
                  id={`evo-task-${overview.evoAction.taskId}`}
                  className="scroll-mt-24"
                >
                  <summary className="min-h-11 cursor-pointer list-none rounded-nav py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    <span className="flex flex-wrap items-start justify-between gap-2">
                      <span>
                        <span className="block">{overview.evoAction.title}</span>
                        {evoDueLabel ? (
                          <span className="mt-1 block text-xs font-normal text-fg-3">
                            Срок: {evoDueLabel}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-xs font-normal text-accent">
                          Подробнее
                        </span>
                      </span>
                      <PortalStatus label={evoStatus.label} tone={evoStatus.tone} />
                    </span>
                  </summary>
                  <div className="mt-2 border-s-2 border-border-strong ps-3">
                    <p className="text-xs font-normal leading-5 text-fg-3">
                      Исполнитель этой задачи — команда EVO.
                    </p>
                  </div>
                </details>
              ) : (
                <span className="font-normal text-fg-3">
                  Нет опубликованной задачи команды EVO.
                </span>
              )}
            </PortalDefinition>
          </dl>
        </div>
      </PortalSection>

      <PortalSection title="Ваш куратор">
        <div className="px-4 py-5 sm:px-5">
          {overview.curatorDisplayName ? (
            <p className="text-base font-semibold text-fg">
              {overview.curatorDisplayName}
            </p>
          ) : (
            <p className="text-sm leading-6 text-fg-3">
              Куратор пока не назначен. Его имя появится здесь после назначения.
            </p>
          )}
        </div>
      </PortalSection>
    </div>
  );
}
