import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";

import { Pipeline } from "@/components/v3/Pipeline";
import { ManualLeadForm } from "@/components/v3/ManualLeadForm";
import { requireV3PageActor } from "@/lib/platform-guards";
import {
  PLATFORM_SALES_STAGES,
  type PlatformSalesStage,
} from "@/lib/platform-sales-contract";
import {
  readPipelineLeads,
  readPipelineOwnerOptions,
  readPipelineStages,
  type PipelineBoardFilters,
} from "@/lib/v3/pipeline-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Воронка продаж" };

/**
 * Имена параметров — контракт адресной строки, на него ссылаются другие
 * экраны (например, карточки главной). Не переименовывать.
 */
type SearchParams = Readonly<{
  q?: string | string[];
  stage?: string | string[];
  due?: string | string[];
  assignment?: string | string[];
  owner?: string | string[];
  handed?: string | string[];
}>;

type BoardQuery = Readonly<{
  q: string | null;
  stage: PlatformSalesStage | "handed_off" | "all";
  due: PipelineBoardFilters["due"];
  assignment: PipelineBoardFilters["assignment"];
  owner: string | null;
  handed: "latest" | "all";
}>;

type FilterChoice = Readonly<{
  key: string;
  title: string;
  href: string;
  active: boolean;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MAX_QUERY_LENGTH = 200;

const CONTROL_CLASS =
  "min-h-11 rounded-ctl border border-control-edge bg-surface px-2.5 text-sm text-fg";

export default async function PipelinePart({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [params, actor] = await Promise.all([
    searchParams,
    requireV3PageActor("/v3/pipeline"),
  ]);
  if (
    actor.presentationRole !== "admin" &&
    actor.presentationRole !== "sales"
  ) {
    throw new Error("Sales route resolved a non-Sales staff role.");
  }
  const query = parseBoardQuery(params);

  const stages = readPipelineStages();
  const filters: PipelineBoardFilters = Object.freeze({
    query: query.q,
    stage: query.stage,
    due: query.due,
    assignment: query.assignment,
    ownerMembershipId: query.owner,
  });
  const [board, ownerOptions] = await Promise.all([
    readPipelineLeads(actor, filters),
    readPipelineOwnerOptions(actor),
  ]);
  const leads = board.leads;
  const requestIds = Object.fromEntries(
    leads.map((lead) => [lead.id, randomUUID()]),
  );

  const stageChoices: readonly FilterChoice[] = [
    allChoice(query.stage === "all", boardHref({ ...query, stage: "all" })),
    ...stages.map((stage) => ({
      key: stage.key,
      title: stage.title,
      href: boardHref({ ...query, stage: stage.key }),
      active: query.stage === stage.key,
    })),
  ];
  const dueChoices: readonly FilterChoice[] = [
    allChoice(query.due === "all", boardHref({ ...query, due: "all" })),
    {
      key: "overdue",
      title: "Просрочено",
      href: boardHref({ ...query, due: "overdue" }),
      active: query.due === "overdue",
    },
    {
      key: "today",
      title: "Сегодня",
      href: boardHref({ ...query, due: "today" }),
      active: query.due === "today",
    },
    {
      key: "unscheduled", title: "Без следующего действия",
      href: boardHref({ ...query, due: "unscheduled" }), active: query.due === "unscheduled",
    },
  ];
  const assignmentChoices: readonly FilterChoice[] = [
    allChoice(
      query.assignment === "all",
      boardHref({ ...query, assignment: "all" }),
    ),
    {
      key: "mine",
      title: "Мои",
      href: boardHref({ ...query, assignment: "mine" }),
      active: query.assignment === "mine",
    },
    {
      key: "unassigned",
      title: "Без ответственного",
      href: boardHref({ ...query, assignment: "unassigned" }),
      active: query.assignment === "unassigned",
    },
  ];

  const filtersActive =
    query.q !== null ||
    query.stage !== "all" ||
    query.due !== "all" ||
    query.assignment !== "all" ||
    query.owner !== null;
  const ownerSelectShown = actor.presentationRole === "admin";
  const ownerListed =
    query.owner === null ||
    ownerOptions.rows.some((row) => row.membershipId === query.owner);

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
        Воронка продаж
      </h1>
      {actor.presentationRole === actor.authorityRole ? <ManualLeadForm requestId={randomUUID()} ownerId={actor.membershipId}
        owners={ownerOptions.rows.map(owner => ({ id: owner.membershipId, displayName: owner.displayLabel }))} /> : null}

      {/* Поиск — форма методом GET, как период на главной: запрос живёт в
          адресе, экран можно переслать целиком. Фильтры, выбранные ссылками
          ниже, форма несёт с собой скрытыми полями, чтобы поиск их не сбрасывал. */}
      <form
        method="get"
        action="/v3/pipeline"
        className="mt-6 flex flex-wrap items-center gap-2"
      >
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
        {!ownerSelectShown && query.owner !== null ? (
          <input type="hidden" name="owner" value={query.owner} />
        ) : null}

        <label className="inline-flex items-center gap-1.5 text-2xs text-fg-3">
          Поиск
          <input
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            maxLength={MAX_QUERY_LENGTH}
            placeholder="Имя, контакт или действие"
            className={`${CONTROL_CLASS} w-64 max-w-full placeholder:text-fg-3`}
          />
        </label>

        {ownerSelectShown ? (
          <label className="inline-flex items-center gap-1.5 text-2xs text-fg-3">
            Сотрудник
            <select
              name="owner"
              defaultValue={query.owner ?? ""}
              className={CONTROL_CLASS}
            >
              <option value="">Все сотрудники</option>
              {!ownerListed && query.owner !== null ? (
                <option value={query.owner}>Выбранный сотрудник</option>
              ) : null}
              {ownerOptions.rows.map((option) => (
                <option key={option.membershipId} value={option.membershipId}>
                  {option.displayLabel}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-ctl bg-accent px-4 text-sm font-medium text-on-accent"
        >
          Найти
        </button>

        {filtersActive ? (
          <Link
            href={boardHref({
              q: null,
              stage: "all",
              due: "all",
              assignment: "all",
              owner: null,
              handed: query.handed,
            })}
            prefetch={false}
            className="inline-flex min-h-11 items-center px-1 text-sm text-fg-2 underline underline-offset-4 hover:text-fg"
          >
            Сбросить всё
          </Link>
        ) : null}
      </form>

      {ownerSelectShown && ownerOptions.hasNext ? (
        <p className="mt-1 text-2xs leading-4 text-fg-3">
          Показаны первые 100 сотрудников.
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        <FilterLinkGroup
          id="v3-pipeline-filter-stage"
          label="Стадия"
          choices={stageChoices}
        />
        <FilterLinkGroup
          id="v3-pipeline-filter-due"
          label="Срок"
          choices={dueChoices}
        />
        <FilterLinkGroup
          id="v3-pipeline-filter-assignment"
          label="Ответственный"
          choices={assignmentChoices}
        />
      </div>

      {board.truncated ? (
        <p className="mt-4 text-2xs leading-4 text-fg-3">
          Прочитаны первые 4000 лидов — используйте поиск или фильтры.
        </p>
      ) : null}

      <div className="mt-6">
        <Pipeline
          stages={stages}
          leads={leads}
          ownerOptions={ownerOptions.rows}
          ownerOptionsHaveMore={ownerOptions.hasNext}
          actorRole={actor.presentationRole}
          actorMembershipId={actor.membershipId}
          requestIds={requestIds}
          handedExpanded={query.handed === "all"}
          handedShowAllHref={boardHref({ ...query, handed: "all" })}
          handedShowLatestHref={boardHref({ ...query, handed: "latest" })}
        />
      </div>
    </main>
  );
}

function FilterLinkGroup({
  id,
  label,
  choices,
}: Readonly<{
  id: string;
  label: string;
  choices: readonly FilterChoice[];
}>) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span id={id} className="w-24 shrink-0 text-2xs text-fg-3">
        {label}
      </span>
      {/* Полоса ссылок не помещается в 393px и прокручивается, поэтому ей
          нужен клавиатурный доступ и собственное имя (SC 2.1.1). */}
      <nav
        aria-labelledby={id}
        tabIndex={0}
        className="min-w-0 max-w-full overflow-x-auto"
      >
        <ul className="flex w-max items-center gap-0.5 rounded-ctl border border-border bg-surface p-0.5">
          {choices.map((choice) => (
            <li key={choice.key}>
              <Link
                href={choice.href}
                prefetch={false}
                aria-current={choice.active ? "page" : undefined}
                className={`inline-flex min-h-9 items-center whitespace-nowrap rounded-nav px-2.5 text-xs ${
                  choice.active
                    ? "bg-accent font-medium text-on-accent"
                    : "text-fg-2 hover:bg-surface-2"
                }`}
              >
                {choice.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function allChoice(active: boolean, href: string): FilterChoice {
  return { key: "all", title: "Все", href, active };
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
