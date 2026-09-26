import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  BoardReset,
  BoardSearch,
  BoardSegments,
  type BoardSegment,
} from "@/components/v3/board/Board";
import { BoardFilters, NavigateSelect, type NavigateOption } from "@/components/v3/board/BoardToolbar";
import { Pipeline } from "@/components/v3/Pipeline";
import { ClosedLeadsList } from "@/components/v3/closure/ClosedLeadsList";
import { Icon } from "@/components/icons";
import { ManualLeadDisclosure, ManualLeadForm, ManualLeadTrigger } from "@/components/v3/ManualLeadForm";
import { PartShell } from "@/components/v3/PartShell";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isStaffPreview } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { parseClosedLeadsCursor, readClosedLeads, type ClosedLeadsPage } from "@/lib/platform-closure";
import { closureWords } from "@/lib/v3/wording";
import {
  PLATFORM_SALES_STAGES,
  type PlatformSalesStage,
} from "@/lib/platform-sales-contract";
import {
  readPipelineWorkspace,
  readPipelineStages,
  type PipelineBoardFilters,
} from "@/lib/v3/pipeline-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Воронка продаж" };

/**
 * Имена параметров — контракт адресной строки, на него ссылаются другие
 * экраны (например, карточки главной). Не переименовывать. `lead` открывает
 * правую панель лида; его читает и меняет сама доска (`Pipeline`).
 */
type SearchParams = Readonly<{
  q?: string | string[];
  stage?: string | string[];
  due?: string | string[];
  assignment?: string | string[];
  owner?: string | string[];
  handed?: string | string[];
  /** «Закрытые» (миграция 246): список закрытых лидов вместо доски. */
  view?: string | string[];
  cursor?: string | string[];
}>;

type BoardQuery = Readonly<{
  q: string | null;
  stage: PlatformSalesStage | "handed_off" | "all";
  due: PipelineBoardFilters["due"];
  assignment: PipelineBoardFilters["assignment"];
  owner: string | null;
  handed: "latest" | "all";
}>;

type FilterChoice = BoardSegment;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MAX_QUERY_LENGTH = 200;

export default async function PipelinePart({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [params, actor] = await Promise.all([
    searchParams,
    requireV3PageActor("/v3/pipeline"),
  ]);
  if (params.view !== undefined) return closedLeadsPart(actor, params);
  const query = parseBoardQuery(params);

  const stages = readPipelineStages();
  // Фокус этапа (`?stage=`) — представление, а не фильтр чтения: доска читает
  // все этапы, чтобы свёрнутые колонки показывали настоящие числа.
  const filters: PipelineBoardFilters = Object.freeze({
    query: query.q,
    stage: "all",
    due: query.due,
    assignment: query.assignment,
    ownerMembershipId: query.owner,
  });
  const { board, ownerOptions, canCreateLead } = await readPipelineWorkspace(actor, filters);
  const ownerRows = ownerOptions?.rows ?? [];
  const leads = board.leads;
  const requestIds = Object.fromEntries(
    leads.map((lead) => [lead.id, randomUUID()]),
  );

  // Числа «Срока» — только из этого чтения: при «Все» и без усечения все
  // группы видны; с выбранным сроком известно только его собственное число.
  // Нет чтения — нет числа. Считаются только рабочие этапы, как в заголовке:
  // переданный лид лежит в свёрнутой колонке «Переданы», и его «Без действия»
  // вело на доску, где все рабочие колонки пусты (аудит 26.09).
  const working = leads.filter((lead) => lead.stageKey !== "handed_off");
  const dueCount = (key: Exclude<BoardQuery["due"], "all">, due: "overdue" | "today" | "none") =>
    board.truncated ? null
      : query.due === "all" ? working.filter((lead) => lead.due === due).length
      : query.due === key ? working.length
      : null;
  const dueChoices: readonly FilterChoice[] = [
    allChoice(query.due === "all", boardHref({ ...query, due: "all" })),
    {
      key: "overdue",
      title: "Просрочено",
      count: dueCount("overdue", "overdue"),
      href: boardHref({ ...query, due: "overdue" }),
      active: query.due === "overdue",
    },
    {
      key: "today",
      title: "Сегодня",
      count: dueCount("today", "today"),
      href: boardHref({ ...query, due: "today" }),
      active: query.due === "today",
    },
    {
      key: "unscheduled",
      title: "Без действия",
      count: dueCount("unscheduled", "none"),
      href: boardHref({ ...query, due: "unscheduled" }),
      active: query.due === "unscheduled",
    },
  ];

  // «Ответственный» — один выбор вместо «Сотрудника» с «Найти» и отдельного
  // ряда «Ответственный»: те же параметры `assignment` и `owner`.
  const ownerListed =
    query.owner === null ||
    ownerRows.some((row) => row.membershipId === query.owner);
  const responsibleOptions: readonly NavigateOption[] = [
    { value: "all", label: "Все", href: boardHref({ ...query, assignment: "all", owner: null }) },
    { value: "mine", label: "Мои", href: boardHref({ ...query, assignment: "mine", owner: null }) },
    { value: "unassigned", label: "Без ответственного", href: boardHref({ ...query, assignment: "unassigned", owner: null }) },
    ...(!ownerListed && query.owner !== null
      ? [{ value: query.owner, label: "Выбранный сотрудник", href: boardHref({ ...query, assignment: "all", owner: query.owner }) }]
      : []),
  ];
  const staffOptions: readonly NavigateOption[] = ownerRows.map((option) => ({
    value: option.membershipId,
    label: option.displayLabel,
    href: boardHref({ ...query, assignment: "all", owner: option.membershipId }),
  }));
  const responsibleValue = query.owner ?? query.assignment;

  const filtersActive =
    query.q !== null ||
    query.stage !== "all" ||
    query.due !== "all" ||
    query.assignment !== "all" ||
    query.owner !== null;
  const activeFilterCount = Number(query.due !== "all") + Number(query.assignment !== "all" || query.owner !== null);
  const workingCount = board.truncated ? null : working.length;

  return (
    <ManualLeadDisclosure>
      <PartShell
        width="board"
        title="Воронка продаж"
        count={workingCount}
        action={canCreateLead ? <ManualLeadTrigger /> : undefined}
      >
      {canCreateLead ? <ManualLeadForm requestId={randomUUID()} ownerId={actor.membershipId}
        owners={ownerRows.map(owner => ({ id: owner.membershipId, displayName: owner.displayLabel }))} /> : null}

      {/* Одна строка инструментов 44 px. Поиск — форма методом GET, как
          период на главной: запрос живёт в адресе, экран можно переслать
          целиком. Остальные фильтры поиск несёт скрытыми полями, а выбор
          «Ответственного» и «Срока» применяется сразу, без «Найти». */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 @2xl:gap-3">
        <BoardSearch
          key={query.q ?? ""}
          action="/v3/pipeline"
          defaultValue={query.q ?? ""}
          maxLength={MAX_QUERY_LENGTH}
          placeholder="Имя, контакт или действие"
          hidden={
            <>
              {query.stage !== "all" ? (
                <input type="hidden" name="stage" value={query.stage} />
              ) : null}
              {query.due !== "all" ? (
                <input type="hidden" name="due" value={query.due} />
              ) : null}
              {query.assignment !== "all" ? (
                <input type="hidden" name="assignment" value={query.assignment} />
              ) : null}
              {query.handed === "all" ? (
                <input type="hidden" name="handed" value="all" />
              ) : null}
              {query.owner !== null ? (
                <input type="hidden" name="owner" value={query.owner} />
              ) : null}
            </>
          }
        />

        <BoardFilters activeCount={activeFilterCount}>
          <NavigateSelect
            key={responsibleValue}
            label="Ответственный"
            value={responsibleValue}
            options={responsibleOptions}
            groups={staffOptions.length > 0 ? [{ label: "Сотрудники", options: staffOptions }] : []}
          />
          <BoardSegments label="Срок" showLabel items={dueChoices} />
        </BoardFilters>

        {/* Закрытые лиды — не этап доски, а отдельный тихий список (246). */}
        <Link href={CLOSED_VIEW_PATH} prefetch={false} data-testid="v3-pipeline-closed-link"
          className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg @2xl:order-last @2xl:ms-auto">
          {closureWords.lead.closedList}
        </Link>

        {filtersActive ? (
          <BoardReset
            href={boardHref({
              q: null,
              stage: "all",
              due: "all",
              assignment: "all",
              owner: null,
              handed: query.handed,
            })}
          />
        ) : null}
      </div>

      {ownerRows.length > 0 && ownerOptions?.hasNext ? (
        <p className="t-meta mt-1 text-fg-3">
          Показаны первые 100 сотрудников.
        </p>
      ) : null}

      {board.truncated ? (
        <p className="t-meta mt-2 text-fg-3">
          Прочитаны первые 4000 лидов — уточните поиск или фильтры.
        </p>
      ) : null}

      {/* Доска занимает оставшуюся высоту: на широком экране прокручиваются
          колонки, на узком (список этапов) — эта область. */}
      <div className="mt-3 flex min-w-0 flex-col md:min-h-[320px] md:flex-1 md:overflow-y-auto @6xl:overflow-visible">
        <Pipeline
          stages={stages}
          leads={leads}
          filteredStage={query.stage}
          ownerOptions={ownerRows}
          ownerOptionsHaveMore={ownerOptions?.hasNext ?? false}
          actor={actor}
          actorMembershipId={actor.membershipId}
          requestIds={requestIds}
          handedExpanded={query.handed === "all"}
          showOwner={query.assignment !== "mine"}
        />
      </div>
      </PartShell>
    </ManualLeadDisclosure>
  );
}

const CLOSED_VIEW_PATH = "/v3/pipeline?view=closed";

/**
 * «Закрытые лиды»: отдельная страница-список поверх той же навигации «Воронки
 * продаж». Адрес — `?view=closed[&cursor=…]`, другие параметры доски сюда не
 * относятся и отклоняются.
 */
async function closedLeadsPart(actor: ActivePlatformActor, params: SearchParams) {
  const view = singleValue(params.view);
  const rawCursor = singleValue(params.cursor);
  const extra = Object.entries(params).some(([key, value]) => value !== undefined && key !== "view" && key !== "cursor");
  const cursor = rawCursor === undefined ? null : parseClosedLeadsCursor(rawCursor);
  if (view !== "closed" || extra || (rawCursor !== undefined && cursor === null)) notFound();
  let page: ClosedLeadsPage | null = null;
  try {
    page = await readClosedLeads(actor, { cursor });
  } catch {
    page = null;
  }
  const here = cursor ? `${CLOSED_VIEW_PATH}&cursor=${encodeURIComponent(cursor)}` : CLOSED_VIEW_PATH;
  return (
    <PartShell
      title={closureWords.lead.closedListTitle}
      count={page && cursor === null && page.nextCursor === null ? page.rows.length : null}
      back={
        <Link href="/v3/pipeline" className="inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4">
          <Icon name="arrow-left" size={16} />
          {closureWords.lead.backToBoard}
        </Link>
      }
      dense
    >
      <ClosedLeadsList
        page={page}
        readOnly={isStaffPreview(actor)}
        retryHref={here}
        firstHref={CLOSED_VIEW_PATH}
        nextHref={page?.nextCursor ? `${CLOSED_VIEW_PATH}&cursor=${encodeURIComponent(page.nextCursor)}` : null}
        paged={cursor !== null}
        leadHref={(leadId) => `/v3/profile?id=${leadId}&returnTo=${encodeURIComponent(here)}`}
      />
    </PartShell>
  );
}

function allChoice(active: boolean, href: string): FilterChoice {
  return { key: "all", title: "Все", count: null, href, active };
}

function boardHref(query: BoardQuery): string {
  const params = new URLSearchParams();
  if (query.q !== null) params.set("q", query.q);
  if (query.stage !== "all") params.set("stage", query.stage);
  if (query.due !== "all") params.set("due", query.due);
  if (query.assignment !== "all") params.set("assignment", query.assignment);
  if (query.owner !== null) params.set("owner", query.owner);
  if (query.handed === "all") params.set("handed", "all");
  const search = params.toString();
  return search ? `/v3/pipeline?${search}` : "/v3/pipeline";
}

function parseBoardQuery(params: SearchParams): BoardQuery {
  return Object.freeze({
    q: parseSearchText(params.q),
    stage: parseStage(params.stage),
    due: parseOneOf(params.due, ["overdue", "today", "unscheduled"] as const),
    assignment: parseOneOf(
      params.assignment,
      ["unassigned", "mine"] as const,
    ),
    owner: parseOwner(params.owner),
    handed: parseHanded(params.handed),
  });
}

function parseSearchText(raw: string | string[] | undefined): string | null {
  const value = singleValue(raw);
  if (value === undefined) return null;
  if (
    CONTROL_CHARACTER_PATTERN.test(value) ||
    value.length > MAX_QUERY_LENGTH
  ) {
    notFound();
  }
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function parseStage(
  raw: string | string[] | undefined,
): PlatformSalesStage | "handed_off" | "all" {
  const value = singleValue(raw);
  if (value === undefined || value === "" || value === "all") return "all";
  if (value === "handed_off") return "handed_off";
  const stage = PLATFORM_SALES_STAGES.find((key) => key === value);
  if (stage === undefined) notFound();
  return stage;
}

function parseOneOf<Value extends string>(
  raw: string | string[] | undefined,
  values: readonly Value[],
): Value | "all" {
  const value = singleValue(raw);
  if (value === undefined || value === "" || value === "all") return "all";
  const matched = values.find((one) => one === value);
  if (matched === undefined) notFound();
  return matched;
}

function parseOwner(raw: string | string[] | undefined): string | null {
  const value = singleValue(raw);
  if (value === undefined || value === "") return null;
  if (!UUID_PATTERN.test(value)) notFound();
  return value;
}

function parseHanded(raw: string | string[] | undefined): "latest" | "all" {
  const value = singleValue(raw);
  if (value === undefined || value === "") return "latest";
  if (value !== "all") notFound();
  return "all";
}

function singleValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) notFound();
  return value;
}
