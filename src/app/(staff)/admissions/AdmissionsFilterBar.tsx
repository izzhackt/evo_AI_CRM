import { Card, btnCls, btnGhostCls, cn, inputCls, labelCls } from "@/components/ui";
import {
  ADMISSIONS_NO_CURATOR,
  admissionsFilterQuery,
  isEmptyAdmissionsFilter,
  type AdmissionsFilter,
} from "@/lib/platform-admissions-filters";

/**
 * A plain GET form. Filtering is a read, so the state belongs in the URL: the
 * result is shareable, survives a reload, and the export link carries exactly
 * the same query the screen was rendered from.
 */
export function AdmissionsFilterBar({
  action,
  filter,
  curatorOptions,
  matchedCount,
  totalCount,
}: {
  action: string;
  filter: AdmissionsFilter;
  curatorOptions: readonly string[];
  matchedCount: number;
  totalCount: number;
}) {
  const exportQuery = new URLSearchParams(
    admissionsFilterQuery(filter).replace(/^\?/, ""),
  );
  const scope = action.replace(/^\/admissions\/?/, "");
  if (scope) exportQuery.set("country", decodeURIComponent(scope));
  const exportHref = `/api/platform-admissions/export${
    exportQuery.toString() ? `?${exportQuery.toString()}` : ""
  }`;

  return (
    <Card>
      <form method="get" action={action} className="grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="admissions-from" className={labelCls}>
            Заведено с
          </label>
          <input
            id="admissions-from"
            name="from"
            type="date"
            defaultValue={filter.from ?? ""}
            className={cn(inputCls, "font-mono")}
          />
        </div>
        <div>
          <label htmlFor="admissions-to" className={labelCls}>
            по
          </label>
          <input
            id="admissions-to"
            name="to"
            type="date"
            defaultValue={filter.to ?? ""}
            className={cn(inputCls, "font-mono")}
          />
        </div>
        <div>
          <label htmlFor="admissions-curator" className={labelCls}>
            Куратор
          </label>
          <select
            id="admissions-curator"
            name="curator"
            defaultValue={filter.curator ?? ""}
            className={inputCls}
          >
            <option value="">Все</option>
            <option value={ADMISSIONS_NO_CURATOR}>Без куратора</option>
            {curatorOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className={btnCls}>
            Применить
          </button>
          {isEmptyAdmissionsFilter(filter) ? null : (
            <a href={action} className={btnGhostCls}>
              Сбросить
            </a>
          )}
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">
          {isEmptyAdmissionsFilter(filter)
            ? `Дел: ${totalCount}`
            : `Дел по фильтру: ${matchedCount} из ${totalCount}`}
        </p>
        <a href={exportHref} className="text-[13px] text-accent underline">
          Выгрузить CSV
        </a>
      </div>
    </Card>
  );
}
