import type { PlatformOpToOzoHandoffSummary } from "@/lib/platform-bw4-workflow";

type Labels = Readonly<Record<string, string>>;

function formatTimestamp(value: string, locale: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const language =
    locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU";
  return new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function roleLabel(
  role: PlatformOpToOzoHandoffSummary["responsibleRole"],
  labels: Labels,
) {
  if (role === "admin") return labels.platformDecisionOwnerAdmin;
  if (role === "sales") return labels.platformDecisionOwnerSales;
  return labels.platformDecisionOwnerCurator;
}

function scalarLabel(
  value: PlatformOpToOzoHandoffSummary["approvedCommercialFieldEntries"][number]["value"],
  labels: Labels,
) {
  if (value === null) return labels.platformHandoffNoneRecorded;
  if (value === true) return labels.platformValueYes;
  if (value === false) return labels.platformValueNo;
  return String(value);
}

function SnapshotList({
  title,
  values,
  emptyLabel,
}: {
  title: string;
  values: readonly string[];
  emptyLabel: string;
}) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
        {title}
      </dt>
      <dd className="mt-1">
        {values.length === 0 ? (
          <span className="text-[11px] text-fg-3">{emptyLabel}</span>
        ) : (
          <ul className="space-y-1 text-[11px] leading-4 text-fg-2">
            {values.map((value, index) => (
              <li key={`${index}-${value}`} className="flex gap-1.5">
                <span aria-hidden="true" className="text-fg-3">
                  •
                </span>
                <span className="min-w-0 break-words">{value}</span>
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

export function PlatformHandoffContextCard({
  studentCaseId,
  handoff,
  locale,
  labels,
}: {
  studentCaseId: string | null;
  handoff: PlatformOpToOzoHandoffSummary | null;
  locale: string;
  labels: Labels;
}) {
  return (
    <section
      aria-labelledby="platform-handoff-context-title"
      className="rounded-ctl border border-border bg-surface-2 p-3"
      data-handoff-state={
        studentCaseId === null
          ? "no-linked-case"
          : handoff === null
            ? "unavailable"
            : "recorded"
      }
      data-testid="platform-handoff-context"
    >
      <h3
        id="platform-handoff-context-title"
        className="text-[11px] font-bold text-fg"
      >
        {labels.platformHandoffContextTitle}
      </h3>
      <p className="mt-1 text-[10.5px] leading-4 text-fg-3">
        {labels.platformHandoffContextHint}
      </p>

      {studentCaseId === null ? (
        <p className="mt-2 rounded-ctl bg-info-weak px-3 py-2 text-[11px] leading-4 text-info">
          {labels.platformHandoffNoLinkedCase}
        </p>
      ) : handoff === null ? (
        <p className="mt-2 rounded-ctl bg-warn-weak px-3 py-2 text-[11px] leading-4 text-warn">
          {labels.platformHandoffUnavailable}
        </p>
      ) : (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformHandoffRecordedAt}
            </dt>
            <dd className="mt-1 text-[11px] font-semibold text-fg-2">
              {formatTimestamp(handoff.createdAt, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformHandoffResponsibleRole}
            </dt>
            <dd className="mt-1 text-[11px] font-semibold text-fg-2">
              {roleLabel(handoff.responsibleRole, labels)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformHandoffNextStep}
            </dt>
            <dd className="mt-1 break-words text-[11px] text-fg-2">
              {handoff.nextStep}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformHandoffDueDate}
            </dt>
            <dd className="mt-1 text-[11px] text-fg-2">
              {formatTimestamp(handoff.dueAt, locale)}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformHandoffCommercialFields}
            </dt>
            <dd className="mt-1">
              {handoff.approvedCommercialFieldEntries.length === 0 ? (
                <span className="text-[11px] text-fg-3">
                  {labels.platformHandoffNoneRecorded}
                </span>
              ) : (
                <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  {handoff.approvedCommercialFieldEntries.map((field) => (
                    <div key={field.key} className="min-w-0">
                      <dt className="break-words text-[10px] text-fg-3">
                        {field.key.replaceAll("_", " ")}
                      </dt>
                      <dd className="break-words text-[11px] font-semibold text-fg-2">
                        {scalarLabel(field.value, labels)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </dd>
          </div>
          <SnapshotList
            title={labels.platformHandoffUnresolvedQuestions}
            values={handoff.unresolvedQuestions}
            emptyLabel={labels.platformHandoffNoneRecorded}
          />
          <SnapshotList
            title={labels.platformHandoffPromises}
            values={handoff.promises}
            emptyLabel={labels.platformHandoffNoneRecorded}
          />
        </dl>
      )}
    </section>
  );
}
