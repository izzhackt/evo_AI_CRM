import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdmissionsPipelineBoard } from "@/components/v3/AdmissionsPipelineBoard";
import { AddStudentDrawer } from "@/components/v3/admissions/AddStudentDrawer";
import { BoardReset, BoardSearch, BoardSegments } from "@/components/v3/board/Board";
import { BoardFilters, NavigateSelect } from "@/components/v3/board/BoardToolbar";
import { PartShell } from "@/components/v3/PartShell";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { readStaffApplicationPackageQueueAction } from "@/lib/portal/application-packages-actions";
import { readStaffApplicationDocumentSubmissionQueueAction } from "@/lib/portal/application-documents-actions";
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
 * Query-string state, same contract style as /v3/pipeline
 * (src/app/(v3)/v3/pipeline/page.tsx's parseBoardQuery/boardHref): the board,
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

const QUEUE_LINK_CLASS =
  "t-meta inline-flex min-h-11 items-center gap-1 text-fg-2 underline-offset-4 hover:text-fg hover:underline";

/**
 * Очереди на проверку живут в EVO Docs (Э8.5, 28.09.2026): ссылки шапки и
 * прежние адреса подстраниц доски `?view=documents|packages` ведут на вкладки
 * «Документы программ» и «Комплекты».
 */
const EVO_DOCS_QUEUE_HREF = {
  documents: "/v3/profile?section=docs&view=program",
  packages: "/v3/profile?section=docs&view=packages",
} as const;

/**
 * Первая страница очереди (до 20 записей): число — только из прочитанного;
 * есть продолжение — «20+», чтение не удалось — без числа.
 */
function queueCount(result: PromiseSettledResult<Readonly<{ items: readonly unknown[]; nextCursor: unknown }> | null>): string | null {
  if (result.status !== "fulfilled" || result.value === null) return null;
  const { items, nextCursor } = result.value;
  return nextCursor === null ? String(items.length) : `${items.length}+`;
}

export default async function AdmissionsPipelinePart({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [params, actor] = await Promise.all([
    searchParams,
    requireV3PageActor("/v3/admissions-pipeline"),
  ]);
  const view = singleValue(params.view);
  if (view !== undefined && view !== "documents" && view !== "packages") notFound();
  // Прежние подстраницы доски — вкладки EVO Docs; права проверяет EVO Docs.
  if (view !== undefined) redirect(EVO_DOCS_QUEUE_HREF[view]);
  const query = parseBoardQuery(params);
  const canReadDocuments = !isStaffPreview(actor) && staffHasPermission(actor, "document.read.full");
  // «Добавить студента» (миграция 281): у держателей `case.create.direct` вне
  // просмотра роли. Назначающий кураторов (`case.curator.assign`) выбирает
  // куратора или оставляет дело ждать его; куратор заводит студента себе.
  const canAddStudent = !isStaffPreview(actor) && staffHasPermission(actor, "case.create.direct");
  const assignsCurators = !isStaffPreview(actor) && staffHasPermission(actor, "case.curator.assign");

  const owner = { organizationId: actor.organizationId, membershipId: actor.membershipId };
  const [boardResult, curatorsResult, documentsResult, packagesResult, addCuratorsResult] = await Promise.allSettled([
    readAdmissionsPipelineBoard(actor, {
      country: query.country,
      curatorMembershipId: query.curator,
      query: query.q,
    }),
    // Same gate as /v3/profile: who assigns curators (the Admin and
    // `case.curator.assign`, migration 248) reads their names; a curator
    // never issues a call that always fails.
    !isStaffPreview(actor) && staffHasPermission(actor, "case.curator.assign")
      ? listStudentPortalActiveCurators(actor)
      : Promise.resolve([]),
    // Числа очередей в шапке — первые страницы тех же чтений, что у вкладок
    // EVO Docs; без права на документы очереди не читаются вовсе.
    canReadDocuments
      ? readStaffApplicationDocumentSubmissionQueueAction(owner).then((result) => (result.ok ? result.page : null))
      : Promise.resolve(null),
    canReadDocuments
      ? readStaffApplicationPackageQueueAction(owner).then((result) => (result.ok ? result.queue : null))
      : Promise.resolve(null),
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
  const documentsCount = queueCount(documentsResult);
  const packagesCount = queueCount(packagesResult);

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

  // Очередь без дел — не повод для ссылки: «0» в шапке ничего не говорит.
  // Число не прочитано (null) или неполное («20+») — ссылка остаётся.
  const queueLinks = canReadDocuments
    ? ([
      { key: "documents", label: "Документы на проверку", count: documentsCount, href: EVO_DOCS_QUEUE_HREF.documents },
      { key: "packages", label: "Комплекты на проверку", count: packagesCount, href: EVO_DOCS_QUEUE_HREF.packages },
    ] as const).filter((link) => link.count !== "0")
    : [];
  const queues = queueLinks.length > 0 ? (
    // Одна тихая строка и на телефоне: две ссылки столбиком отодвигали доску
    // на 180 px вниз.
    <nav aria-label="Очереди на проверку" className="flex flex-wrap items-center gap-x-2">
      {queueLinks.map((link, index) => (
        <span key={link.key} className="inline-flex items-center gap-x-2">
          {index > 0 ? <span aria-hidden="true" className="t-meta text-fg-3">·</span> : null}
          <Link className={QUEUE_LINK_CLASS} href={link.href}>
            {link.label}
            {link.count !== null ? <span className="tabular-nums text-fg-3">{link.count}</span> : null}
          </Link>
        </span>
      ))}
    </nav>
  ) : undefined;

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

  return (
    <PartShell
      width="board"
      title="Воронка поступления"
      action={queues || addStudent ? (
        // Телефон: главное действие над ссылками очередей, не под ними.
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 max-sm:flex-col-reverse max-sm:flex-nowrap max-sm:items-end">
          {queues}
          {addStudent}
        </div>
      ) : undefined}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 @2xl:gap-3">
        <BoardSegments
          label="Разделы воронки поступления"
          items={(["admission", "visa"] as const satisfies readonly AdmissionsPipelineTab[]).map((tabKey) => ({
            key: tabKey,
            title: admissionsPipelineTab(tabKey),
            count: tabCount(tabKey),
            href: boardHref({ ...query, tab: tabKey }),
            active: query.tab === tabKey,
          }))}
        />

        <BoardSearch
          key={boardHref(query)}
          action="/v3/admissions-pipeline"
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

        {filtersActive ? (
          <BoardReset href={boardHref({ tab: query.tab, q: null, country: null, curator: null })} />
        ) : null}
      </div>

      <div className="mt-3 flex min-w-0 flex-col md:min-h-[320px] md:flex-1 md:overflow-y-auto @5xl:overflow-visible">
        <AdmissionsPipelineBoard
          rows={board?.rows ?? []}
          truncated={board?.truncated ?? false}
          boardUnavailable={boardResult.status === "rejected"}
          tab={query.tab}
          query={{ q: query.q, country: query.country, curator: query.curator }}
          requestedStage={singleValue(params.stage) ?? null}
        />
      </div>
    </PartShell>
  );
}

function boardHref(query: BoardQuery): string {
  const params = new URLSearchParams();
  if (query.tab !== "admission") params.set("tab", query.tab);
  if (query.q !== null) params.set("q", query.q);
  if (query.country !== null) params.set("country", query.country);
  if (query.curator !== null) params.set("curator", query.curator);
  const search = params.toString();
  return search ? `/v3/admissions-pipeline?${search}` : "/v3/admissions-pipeline";
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
