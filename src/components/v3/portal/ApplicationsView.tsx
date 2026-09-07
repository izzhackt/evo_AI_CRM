import { PortalEmptyState, PortalSection } from "./PortalPage";
import { PortalStatus } from "./PortalStatus";
import type {
  PortalApplicationItem,
  PortalApplicationsView as PortalApplicationsViewModel,
  PortalTimelineItem,
} from "./types";

function Timeline({ items }: { items: readonly PortalTimelineItem[] }) {
  if (items.length === 0) return null;

  return (
    <details className="mt-4 border-t border-border pt-3">
      <summary className="min-h-10 cursor-pointer py-2 text-sm font-medium text-fg-2 marker:text-fg-3">
        История статусов
      </summary>
      <ol className="mt-2 space-y-3 border-s border-border-strong ps-4">
        {items.map((item) => (
          <li key={item.id} className="relative text-sm leading-5 text-fg-2">
            <span
              className="absolute -start-[19px] top-1.5 size-2 rounded-full border border-control-edge bg-surface"
              aria-hidden="true"
            />
            <span className="font-medium text-fg">{item.label}</span>
            {item.occurredLabel ? (
              <time className="mt-0.5 block text-xs text-fg-3">
                {item.occurredLabel}
              </time>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function ApplicationRow({ application }: { application: PortalApplicationItem }) {
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
        </div>
        <PortalStatus status={application.status} />
      </div>
      {application.deadlineLabel ? (
        <p className="mt-3 text-xs text-fg-3">
          Дедлайн: <span className="font-medium text-fg-2">{application.deadlineLabel}</span>
        </p>
      ) : null}
      <Timeline items={application.timeline} />
    </li>
  );
}

export function ApplicationsView({ view }: { view: PortalApplicationsViewModel }) {
  const hasApplications = view.applications.length > 0;

  if (!hasApplications && view.visa === null) {
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
            {view.applications.map((application) => (
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
        {view.visa ? (
          <div className="px-4 py-5 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-sm font-semibold leading-6 text-fg">
                {view.visa.title}
              </h3>
              <PortalStatus status={view.visa.status} />
            </div>
            <Timeline items={view.visa.timeline} />
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
