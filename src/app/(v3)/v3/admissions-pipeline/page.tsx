import Link from "next/link";
import { notFound } from "next/navigation";

import { AdmissionsPipelineBoard } from "@/components/v3/AdmissionsPipelineBoard";
import { PartShell } from "@/components/v3/PartShell";
import { isStaffPreview } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import {
  readAdmissionsPipelineBoard,
  type AdmissionsPipelineTab,
} from "@/lib/platform-admissions-pipeline";
import {
  PLATFORM_APPLICATION_COUNTRIES,
  isPlatformApplicationCountryCode,
} from "@/lib/platform-application-contract";
import { listStudentPortalActiveCurators } from "@/lib/server/student-portal-curator-options";
import { country as countryLabel } from "@/lib/v3/wording";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Воронка поступления" };

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

const CONTROL_CLASS =
  "min-h-11 rounded-ctl border border-control-edge bg-surface px-2.5 text-sm text-fg";

export default async function AdmissionsPipelinePart({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [params, actor] = await Promise.all([
    searchParams,
    requireV3PageActor("/v3/admissions-pipeline"),
  ]);
  const query = parseBoardQuery(params);

  const [boardResult, curatorsResult] = await Promise.allSettled([
    readAdmissionsPipelineBoard(actor, {
      country: query.country,
      curatorMembershipId: query.curator,
      query: query.q,
    }),
    // Same admin gate as /v3/profile: the helper rejects every non-admin
    // actor, so a curator never issues a call that always fails.
    actor.systemRole === "admin" && !isStaffPreview(actor)
      ? listStudentPortalActiveCurators(actor)
      : Promise.resolve([]),
  ]);
  const board = boardResult.status === "fulfilled" ? boardResult.value : null;
  const curatorOptions = curatorsResult.status === "fulfilled" ? curatorsResult.value : [];

  const filtersActive = query.q !== null || query.country !== null || query.curator !== null;

  return (
    <PartShell title="Воронка поступления">
      <form
        method="get"
        action="/v3/admissions-pipeline"
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="tab" value={query.tab} />

        <label className="inline-flex items-center gap-1.5 text-2xs text-fg-3">
          Поиск
          <input
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            maxLength={MAX_QUERY_LENGTH}
            placeholder="Имя студента"
            className={`${CONTROL_CLASS} w-64 max-w-full placeholder:text-fg-3`}
          />
        </label>

        <label className="inline-flex items-center gap-1.5 text-2xs text-fg-3">
          Страна
          <select name="country" defaultValue={query.country ?? ""} className={CONTROL_CLASS}>
            <option value="">Все страны</option>
            {PLATFORM_APPLICATION_COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {countryLabel(code)}
              </option>
            ))}
          </select>
        </label>

        {curatorOptions.length === 0 && query.curator !== null ? (
          <input type="hidden" name="curator" value={query.curator} />
        ) : null}
        {curatorOptions.length > 0 ? (
          <label className="inline-flex items-center gap-1.5 text-2xs text-fg-3">
            Куратор
            <select name="curator" defaultValue={query.curator ?? ""} className={CONTROL_CLASS}>
              <option value="">Все кураторы</option>
              {curatorOptions.map((option) => (
                <option key={option.membershipId} value={option.membershipId}>
                  {option.displayName}
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
            href={boardHref({ tab: query.tab, q: null, country: null, curator: null })}
            prefetch={false}
            className="inline-flex min-h-11 items-center px-1 text-sm text-fg-2 underline underline-offset-4 hover:text-fg"
          >
            Сбросить всё
          </Link>
        ) : null}
      </form>

      <div className="mt-6">
        <AdmissionsPipelineBoard
          rows={board?.rows ?? []}
          truncated={board?.truncated ?? false}
          boardUnavailable={boardResult.status === "rejected"}
          tab={query.tab}
          query={{ q: query.q, country: query.country, curator: query.curator }}
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
