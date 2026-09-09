import Link from "next/link";

import { Pill, type PillTone } from "@/components/v3/Pill";
import type {
  V3ProfileCaseDirectory,
  V3ProfileCaseDirectoryParams,
  V3ProfileCaseDirectoryRow,
} from "@/lib/v3/profile-source";

const STATE_COPY = {
  active: "Активное",
  closed: "Закрыто",
  pending: "Ожидает",
} as const;

const STATE_TONE: Record<keyof typeof STATE_COPY, PillTone> = {
  active: "ok",
  closed: "neutral",
  pending: "warn",
};

const UPDATED_AT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  timeZone: "Asia/Bishkek",
  year: "numeric",
});

function directoryHref(
  params: V3ProfileCaseDirectoryParams,
  cursor?: Readonly<{ sortAt: string; id: string }>,
): string {
  const query = new URLSearchParams();
  if (params.query) query.set("case_q", params.query);
  if (params.state) query.set("case_status", params.state);
  if (cursor) {
    query.set("case_before_at", cursor.sortAt);
    query.set("case_before_id", cursor.id);
  }
  const serialized = query.toString();
  return serialized ? `/v3/profile?${serialized}` : "/v3/profile";
}

function attention(row: V3ProfileCaseDirectoryRow): string {
  if (row.access !== "full") return "Только итог передачи";
  return [
    `задачи ${row.overdueTaskCount}`,
    `платежи ${row.overdueObligationCount}`,
    `документы ${row.rejectedDocumentCount}`,
  ].join(" · ");
}

function profileHref(row: V3ProfileCaseDirectoryRow): string | null {
  if (row.access === "full") {
    return `/v3/profile?case=${row.studentCaseId}&tab=overview`;
  }
  return row.leadId ? `/v3/profile?id=${row.leadId}` : null;
}

export function ProfileCaseDirectory({
  directory,
  initiallyOpen,
  params,
}: Readonly<{
  directory: V3ProfileCaseDirectory;
  initiallyOpen: boolean;
  params: V3ProfileCaseDirectoryParams;
}>) {
  return (
    <details
      className="min-w-0 rounded-card border border-border bg-surface"
      data-testid="v3-student-case-directory"
      open={initiallyOpen}
    >
      <summary className="min-h-11 cursor-pointer px-4 py-4 text-base font-semibold text-fg marker:text-fg-3 sm:px-5">
        Найти студента
        <span className="ml-2 text-sm font-normal text-fg-2">
          {params.invalid ? "—" : `${directory.rows.length} в списке`}
        </span>
      </summary>

      <div className="min-w-0 space-y-4 border-t border-border px-4 py-5 sm:px-5">
        <form
          key={JSON.stringify([params.query, params.state])}
          action="/v3/profile"
          method="get"
          className="grid gap-3 @3xl:grid-cols-[minmax(260px,1fr)_minmax(180px,0.35fr)_auto]"
          aria-label="Найти студента"
        >
          <label className="grid min-w-0 gap-1.5 text-sm font-medium text-fg-2">
            Имя, маршрут или страна
            <input
              className="min-h-11 min-w-0 w-full rounded-nav border border-control-edge bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
              defaultValue={params.query}
              name="case_q"
              placeholder="Имя студента или страна"
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-medium text-fg-2">
            Статус дела
            <select
              className="min-h-11 rounded-nav border border-control-edge bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
              defaultValue={params.state ?? ""}
              name="case_status"
            >
              <option value="">Все статусы</option>
              <option value="pending">Ожидает</option>
              <option value="active">Активное</option>
              <option value="closed">Закрыто</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="min-h-11 rounded-nav bg-accent px-4 text-sm font-semibold text-on-accent"
            >
              Найти
            </button>
            {/* A document navigation also clears unapplied native form edits. */}
            <a
              className="inline-flex min-h-11 items-center rounded-nav border border-control-edge px-4 text-sm font-medium text-fg-2 hover:bg-surface-2"
              href="/v3/profile"
            >
              Сбросить
            </a>
          </div>
        </form>

        {params.invalid ? (
          <p
            className="v3-edge-danger rounded-nav border border-border border-s-2 bg-surface px-4 py-3 text-sm text-danger"
            data-testid="v3-student-case-filter-rejected"
          >
            Не удалось применить фильтры. Проверьте запрос или сбросьте поиск.
          </p>
        ) : directory.rows.length === 0 ? (
          <div className="space-y-2 py-8 text-center">
            <p className="text-base font-medium text-fg">
              {params.query || params.state || params.cursor
                ? "По вашему запросу ничего не найдено."
                : "Пока нет доступных дел студентов."}
            </p>
            <p className="text-sm text-fg-2">
              {params.query || params.state || params.cursor
                ? "Измените запрос или сбросьте фильтры."
                : "Здесь появятся дела, к которым у вас есть доступ."}
            </p>
          </div>
        ) : (
          <div role="region" aria-label="Результаты поиска студентов" tabIndex={0} className="relative max-w-full overflow-x-auto rounded-nav border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <table className="w-full min-w-[920px] text-left text-sm">
              <caption className="sr-only">Доступные дела студентов</caption>
              <thead className="border-b border-border bg-surface-2 text-xs text-fg-2">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Студент</th>
                  <th scope="col" className="px-3 py-3 font-medium">Маршрут</th>
                  <th scope="col" className="px-3 py-3 font-medium">Статус</th>
                  <th scope="col" className="px-3 py-3 font-medium">Ответственные</th>
                  <th scope="col" className="px-3 py-3 font-medium">Внимание</th>
                  <th scope="col" className="px-4 py-3 font-medium">Обновлено</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {directory.rows.map((row) => {
                  const href = profileHref(row);
                  return (
                  <tr
                    className="align-top hover:bg-surface-2"
                    data-access={row.access}
                    data-student-case-id={row.studentCaseId}
                    data-testid="v3-student-case-row"
                    key={row.studentCaseId}
                  >
                    <td className="min-w-[180px] max-w-[280px] break-words px-4 py-3">
                      {href ? (
                        <Link
                          className="inline-flex min-h-11 items-center font-semibold text-fg hover:text-accent hover:underline"
                          href={href}
                        >
                          {row.studentDisplayName}
                        </Link>
                      ) : (
                        <span className="font-semibold text-fg">
                          {row.studentDisplayName}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="block text-fg">
                        {row.operationalStage ?? "Передано куратору"}
                      </span>
                      <span className="mt-1 block text-xs text-fg-3">
                        {[row.targetCountry, row.targetDegree]
                          .filter(Boolean)
                          .join(" · ") || "Маршрут не заполнен"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <Pill tone={STATE_TONE[row.state]}>
                        {STATE_COPY[row.state]}
                      </Pill>
                    </td>
                    <td className="min-w-[180px] max-w-[280px] break-words px-3 py-3 text-xs leading-5 text-fg-2">
                      <span className="block">
                        Продажи: {row.responsibleSalesDisplayName ?? "—"}
                      </span>
                      <span className="block">
                        Куратор: {row.admissionsDisplayName ?? "—"}
                      </span>
                      {row.leadId && row.access === "full" ? (
                        <Link
                          className="inline-flex min-h-11 items-center font-medium text-accent hover:underline"
                          href={`/v3/profile?id=${row.leadId}`}
                        >
                          Открыть связанный лид
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-xs leading-5 text-fg-2">
                      {attention(row)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-fg-3">
                      {row.updatedAt
                        ? UPDATED_AT.format(new Date(row.updatedAt))
                        : "—"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <nav
          aria-label="Страницы каталога студентов"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          {params.cursor ? (
            <Link
              className="inline-flex min-h-11 items-center text-sm font-medium text-fg-2 hover:text-fg"
              href={directoryHref(params)}
            >
              ← К началу
            </Link>
          ) : (
            <span />
          )}
          {directory.hasNext && directory.nextCursor ? (
            <Link
              className="inline-flex min-h-11 items-center text-sm font-medium text-fg-2 hover:text-fg"
              href={directoryHref(params, directory.nextCursor)}
              rel="next"
            >
              Следующие записи →
            </Link>
          ) : null}
        </nav>
      </div>
    </details>
  );
}
