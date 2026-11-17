import { notFound, redirect } from "next/navigation";

import { AdmissionsPipelineNextLazy } from "@/components/staff/admissions-pipeline-next/AdmissionsPipelineNextLazy";
import { AddStudentDrawer } from "@/components/staff/admissions/AddStudentDrawer";
import { BoardReset, BoardSearch } from "@/components/staff/board/Board";
import { BoardFilters, NavigateSelect } from "@/components/staff/board/BoardToolbar";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import {
  readAdmissionsPipelineBoard,
  type AdmissionsPipelineTab,
} from "@/lib/platform-admissions-pipeline";
import { admissionsPipelineTabOf } from "@/lib/platform-admissions-pipeline-contract";
import {
  PLATFORM_APPLICATION_COUNTRIES,
  isPlatformApplicationCountryCode,
} from "@/lib/platform-application-contract";
import { listStudentPortalActiveCurators } from "@/lib/server/student-portal-curator-options";
import { readAdmissionsDirectCuratorOptions } from "@/lib/v3/admissions-direct-student-source";
import { admissionsPipelineTab, country as countryLabel } from "@/lib/v3/wording";

export const dynamic = "force-dynamic";
export const metadata = { title: "Воронка поступления" };

/**
 * Query-string state, same contract style as /pipeline
 * (src/app/(staff)/pipeline/page.tsx's parseBoardQuery/boardHref): the board,
 * its filters and its active tab live entirely in the URL, so returning from
 * a case preserves them without any client-side storage.
 */
type SearchParams = Readonly<{
  tab?: string | string[];
  q?: string | string[];
  country?: string | string[];
  curator?: string | string[];
  view?: string | string[];
  /** Этап, открытый на телефоне (Э8.11); чужой или неизвестный — не учитывается. */
  stage?: string | string[];
}>;

type BoardQuery = Readonly<{
  tab: AdmissionsPipelineTab;
  q: string | null;
  country: string | null;
  curator: string | null;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MAX_QUERY_LENGTH = 200;

export default async function AdmissionsPipelinePart({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [params, actor] = await Promise.all([
    searchParams,
    requireV3PageActor("/admissions-pipeline"),
  ]);
  const view = singleValue(params.view);
  if (view !== undefined && view !== "documents" && view !== "packages") notFound();
  // Прежние подстраницы доски (`?view=documents|packages`) убраны: доска — одна страница.
  if (view !== undefined) redirect("/admissions-pipeline");
  const query = parseBoardQuery(params);
  // «Добавить студента» (миграция 281): у держателей `case.create.direct` вне
  // просмотра роли. Назначающий кураторов (`case.curator.assign`) выбирает
  // куратора или оставляет дело ждать его; куратор заводит студента себе.
  const canAddStudent = !isStaffPreview(actor) && staffHasPermission(actor, "case.create.direct");
  const assignsCurators = !isStaffPreview(actor) && staffHasPermission(actor, "case.curator.assign");

  const [boardResult, curatorsResult, addCuratorsResult] = await Promise.allSettled([
    readAdmissionsPipelineBoard(actor, {
      country: query.country,
      curatorMembershipId: query.curator,
      query: query.q,
    }),
    // Same gate as /profile: who assigns curators (the Admin and
    // `case.curator.assign`, migration 248) reads their names; a curator
    // never issues a call that always fails.
    !isStaffPreview(actor) && staffHasPermission(actor, "case.curator.assign")
      ? listStudentPortalActiveCurators(actor)
      : Promise.resolve([]),
    // «Куратор» в «Добавить студента»: только те, кого актёр может назначить
    // (правило области команды 281), и можно ли оставить дело без куратора.
    canAddStudent && assignsCurators ? readAdmissionsDirectCuratorOptions(actor) : Promise.resolve(null),
  ]);
  const board = boardResult.status === "fulfilled" ? boardResult.value : null;
  const curatorOptions = curatorsResult.status === "fulfilled" ? curatorsResult.value : [];

  const filtersActive = query.q !== null || query.country !== null || query.curator !== null;
  // Числа разделов — из того же чтения доски; при усечении или без чтения
  // числа нет.
  const tabCount = (tabKey: AdmissionsPipelineTab) =>
    board && !board.truncated ? board.rows.filter((row) => admissionsPipelineTabOf(row.pipelineStage) === tabKey).length : null;

  // Чтение списка не удалось: прежний список кураторов организации; базу это
  // не обходит, а отказ говорит, кого выбрать.
  const addCurators = addCuratorsResult.status === "fulfilled" && addCuratorsResult.value !== null
    ? addCuratorsResult.value
    : { options: curatorOptions, withoutCurator: true };
  const addStudent = canAddStudent ? (
    <AddStudentDrawer
      curator={assignsCurators
        ? { kind: "choose", options: addCurators.options, withoutCurator: addCurators.withoutCurator }
        : { kind: "self", membershipId: actor.membershipId }}
    />
  ) : null;

  const countryOptions = [
    { value: "", label: "Все страны", href: boardHref({ ...query, country: null }) },
    ...PLATFORM_APPLICATION_COUNTRIES.map((code) => ({
      value: code,
      label: countryLabel(code) ?? code,
      href: boardHref({ ...query, country: code }),
    })),
  ];
  const curatorSelectOptions = [
    { value: "", label: "Все кураторы", href: boardHref({ ...query, curator: null }) },
    ...curatorOptions.map((option) => ({
      value: option.membershipId,
      label: option.displayName,
      href: boardHref({ ...query, curator: option.membershipId }),
    })),
  ];

  const search = (
    <BoardSearch
      key={boardHref(query)}
      action="/admissions-pipeline"
      defaultValue={query.q ?? ""}
      maxLength={MAX_QUERY_LENGTH}
      placeholder="Имя студента"
      hidden={
        <>
          <input type="hidden" name="tab" value={query.tab} />
          {query.country !== null ? <input type="hidden" name="country" value={query.country} /> : null}
          {query.curator !== null ? <input type="hidden" name="curator" value={query.curator} /> : null}
        </>
      }
    />
  );
  const filters = (
    <BoardFilters activeCount={Number(query.country !== null) + Number(query.curator !== null)}>
      <NavigateSelect key={`country:${query.country ?? ""}`} label="Страна" value={query.country ?? ""} options={countryOptions} />
      {curatorOptions.length > 0 ? (
        <NavigateSelect
          key={`curator:${query.curator ?? ""}`}
          label="Куратор"
          value={query.curator ?? ""}
          options={
            query.curator !== null && !curatorOptions.some((option) => option.membershipId === query.curator)
              ? [...curatorSelectOptions, { value: query.curator, label: "Выбранный куратор", href: boardHref(query) }]
              : curatorSelectOptions
          }
        />
      ) : null}
    </BoardFilters>
  );
  const reset = filtersActive ? (
    <BoardReset href={boardHref({ tab: query.tab, q: null, country: null, curator: null })} />
  ) : null;

  // «Новый вид» (переключатель администратора): те же чтения и права, другая расстановка — вкладки разделов, колонки-карточки с
  // перетаскиванием (`@dnd-kit/core`) и те же части строки инструментов.
  return (
    <AdmissionsPipelineNextLazy
      actions={addStudent}
      tabs={(["admission", "visa"] as const satisfies readonly AdmissionsPipelineTab[]).map((tabKey) => ({
        key: tabKey,
        label: admissionsPipelineTab(tabKey),
        count: tabCount(tabKey),
        href: boardHref({ ...query, tab: tabKey }),
      }))}
      toolbar={<div className="flex flex-wrap items-center gap-2 @2xl:gap-3">{search}{filters}{reset}</div>}
      rows={board?.rows ?? []}
      truncated={board?.truncated ?? false}
      boardUnavailable={boardResult.status === "rejected"}
      tab={query.tab}
      query={{ q: query.q, country: query.country, curator: query.curator }}
      requestedStage={singleValue(params.stage) ?? null}
    />
  );
}

function boardHref(query: BoardQuery): string {
  const params = new URLSearchParams();
  if (query.tab !== "admission") params.set("tab", query.tab);
  if (query.q !== null) params.set("q", query.q);
  if (query.country !== null) params.set("country", query.country);
  if (query.curator !== null) params.set("curator", query.curator);
  const search = params.toString();
  return search ? `/admissions-pipeline?${search}` : "/admissions-pipeline";
}

function parseBoardQuery(params: SearchParams): BoardQuery {
  return Object.freeze({
    tab: parseTab(params.tab),
    q: parseSearchText(params.q),
    country: parseCountry(params.country),
    curator: parseCurator(params.curator),
  });
}

function parseTab(raw: string | string[] | undefined): AdmissionsPipelineTab {
  const value = singleValue(raw);
  if (value === undefined || value === "" || value === "admission") return "admission";
  if (value !== "visa") notFound();
  return "visa";
}

function parseSearchText(raw: string | string[] | undefined): string | null {
  const value = singleValue(raw);
  if (value === undefined) return null;
  if (CONTROL_CHARACTER_PATTERN.test(value) || value.length > MAX_QUERY_LENGTH) notFound();
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function parseCountry(raw: string | string[] | undefined): string | null {
  const value = singleValue(raw);
  if (value === undefined || value === "") return null;
  if (!isPlatformApplicationCountryCode(value)) notFound();
  return value;
}

function parseCurator(raw: string | string[] | undefined): string | null {
  const value = singleValue(raw);
  if (value === undefined || value === "") return null;
  if (!UUID_PATTERN.test(value)) notFound();
  return value;
}

function singleValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) notFound();
  return value;
}
