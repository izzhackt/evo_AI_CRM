import type {
  StudentPortalApplication,
  StudentPortalApplications,
} from "@/lib/v3/portal-source";
import { allDayDate, applicationStatus, visaStatus } from "@/lib/v3/wording";

import { PortalEmptyState, PortalSection } from "./PortalPage";
import { PortalStatus } from "./PortalStatus";
import {
  applicationStatusPresentation,
  formatPortalTimestamp,
  visaStatusPresentation,
} from "./presentation";

type TimelineItem = Readonly<{
  label: string | null;
  occurredAt: string;
}>;

function Timeline({ items }: { items: readonly TimelineItem[] }) {
  if (items.length === 0) return null;

  return (
    <details className="mt-4 border-t border-border pt-3">
      <summary className="min-h-10 cursor-pointer py-2 text-sm font-medium text-fg-2 marker:text-fg-3">
        История статусов
      </summary>
      <ol className="mt-2 space-y-3 border-s border-border-strong ps-4">
        {items.map((item, index) => {
          const occurredLabel = formatPortalTimestamp(item.occurredAt);
          return (
            <li
              key={`${item.occurredAt}:${index}`}
              className="relative text-sm leading-5 text-fg-2"
            >
              <span
                className="absolute -start-[19px] top-1.5 size-2 rounded-full border border-control-edge bg-surface"
                aria-hidden="true"
              />
              <PortalStatus label={item.label} tone="neutral" />
              {occurredLabel ? (
                <time
                  dateTime={item.occurredAt}
                  className="mt-0.5 block text-xs text-fg-3"
                >
                  {occurredLabel}
                </time>
              ) : null}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function ApplicationRow({
  application,
}: {
  application: StudentPortalApplication;
}) {
  const status = applicationStatusPresentation(application);
  const deadlineLabel = allDayDate(application.universityDeadlineOn);
  const timeline: readonly TimelineItem[] = application.timeline.map((item) => ({
    label: applicationStatus(item.newStatus),
    occurredAt: item.occurredAt,
  }));

  return (
    <li className="px-4 py-5 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-6 text-fg">
            {application.institutionName}
          </h3>
          <p className="mt-0.5 text-sm leading-5 text-fg-2">
            {application.programName}
          </p>
          {application.isPrimary ? (
            <p className="mt-2 text-xs font-medium text-fg-2">Основная заявка</p>
          ) : null}
        </div>
        <PortalStatus label={status.label} tone={status.tone} />
      </div>
      {deadlineLabel ? (
        <p className="mt-3 text-xs text-fg-3">
          Дедлайн:{" "}
          <time
            dateTime={application.universityDeadlineOn ?? undefined}
            className="font-medium text-fg-2"
          >
            {deadlineLabel}
          </time>
        </p>
      ) : null}
      <Timeline items={timeline} />
    </li>
  );
}

export function ApplicationsView({
  applications,
}: {
  applications: StudentPortalApplications;
}) {
  const hasApplications = applications.applications.length > 0;
  const visa = applications.visa;
  const visaPresentation = visa ? visaStatusPresentation(visa) : null;

  if (!hasApplications && visa === null) {
    return (
      <PortalEmptyState
        title="Заявок пока нет"
        description="Опубликованные университетские заявки и визовое дело появятся здесь."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
      <PortalSection title="Заявки в университеты">
        {hasApplications ? (
          <ul className="divide-y divide-border">
            {applications.applications.map((application) => (
              <ApplicationRow
                key={application.applicationId}
                application={application}
              />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-fg-3 sm:px-5">
            Университетских заявок пока нет.
          </p>
        )}
      </PortalSection>

      <PortalSection title="Виза">
        {visa && visaPresentation ? (
          <div className="px-4 py-5 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-sm font-semibold leading-6 text-fg">
                Визовое дело
              </h3>
              <PortalStatus
                label={visaPresentation.label}
                tone={visaPresentation.tone}
              />
            </div>
            <Timeline
              items={visa.timeline.map((item) => ({
                label: visaStatus(item.newStatus),
                occurredAt: item.occurredAt,
              }))}
            />
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-fg-3 sm:px-5">
            Визовое дело пока не открыто.
          </p>
        )}
      </PortalSection>
    </div>
  );
}
