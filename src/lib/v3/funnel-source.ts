import "server-only";

import type { FunnelStage } from "@/components/v3/Funnel";
import type { Metric } from "@/components/v3/MetricCard";
import type { TrendSeries } from "@/components/v3/TrendChart";
import type { PlatformActor } from "@/lib/platform-auth";
import type { PlatformSalesLeadRow } from "@/lib/platform-sales";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { readAllCanonicalSalesLeads } from "@/lib/v3/pipeline-source";
import { FUNNEL_STEP } from "@/lib/v3/wording";

export const PERIODS = [
  { key: "today", title: "Сегодня" },
  { key: "yesterday", title: "Вчера" },
  { key: "week", title: "Неделя" },
  { key: "month", title: "Месяц" },
  { key: "custom", title: "Период" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];

export type Period = Readonly<{
  key: PeriodKey;
  /** Inclusive `YYYY-MM-DD` bounds in the organization time zone. */
  from: string;
  to: string;
  /** Today in the organization time zone, used by the custom-range controls. */
  today: string;
}>;

const MAX_SPAN_DAYS = 366;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const ORGANIZATION_DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: ORG_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const ORGANIZATION_HOUR_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: ORG_TIMEZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

function parts(iso: string): [number, number, number] {
  const [year, month, day] = iso.split("-").map(Number);
  return [year, month, day];
}

function real(iso: unknown): iso is string {
  if (typeof iso !== "string" || !ISO_DATE.test(iso)) return false;
  const [year, month, day] = parts(iso);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function shift(iso: string, days: number): string {
  const [year, month, day] = parts(iso);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function span(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  const delta = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(delta / 86_400_000) + 1;
}

function organizationDate(value: Date): string {
  const formatted = ORGANIZATION_DATE_PARTS.formatToParts(value);
  const year = formatted.find((part) => part.type === "year")?.value;
  const month = formatted.find((part) => part.type === "month")?.value;
  const day = formatted.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Unable to resolve the EVO organization date.");
  }
  return `${year}-${month}-${day}`;
}

function organizationHour(value: Date): number {
  const hour = ORGANIZATION_HOUR_PARTS.formatToParts(value)
    .find((part) => part.type === "hour")?.value;
  const parsed = hour === undefined ? Number.NaN : Number(hour);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
    throw new Error("Unable to resolve the EVO organization hour.");
  }
  return parsed;
}

function timestamp(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error("Canonical sales data returned an invalid timestamp.");
  }
  return parsed;
}

function dayLabel(iso: string, withYear: boolean): string {
  const [year, month, day] = parts(iso);
  return withYear ? `${day} ${MONTHS[month - 1]} ${year}` : `${day} ${MONTHS[month - 1]}`;
}

function rangeLabel(from: string, to: string, today: string): string {
  const [fromYear] = parts(from);
  const [toYear] = parts(to);
  const [nowYear] = parts(today);

  if (from === to) return dayLabel(from, fromYear !== nowYear);
  if (fromYear !== toYear) return `${dayLabel(from, true)} — ${dayLabel(to, true)}`;
  return `${dayLabel(from, false)} — ${dayLabel(to, fromYear !== nowYear)}`;
}

export function periodLabel(period: Period): string {
  return rangeLabel(period.from, period.to, period.today);
}

/**
 * Resolve the URL range against a server-side clock explicitly pinned to
 * Bishkek. Invalid, reversed and overlong ranges are normalized visibly in the
 * resulting URL controls; none of them can widen the canonical data query.
 */
export function resolvePeriod(
  raw: Readonly<{ period?: string; from?: string; to?: string }>,
): Period {
  const today = organizationDate(new Date());
  const key: PeriodKey = PERIODS.some((one) => one.key === raw.period)
    ? (raw.period as PeriodKey)
    : "month";

  if (key === "custom") {
    const first = real(raw.from) ? raw.from : null;
    const second = real(raw.to) ? raw.to : null;
    const named = first ?? second;
    if (named) {
      const other = second ?? first ?? named;
      let from = named <= other ? named : other;
      const to = named <= other ? other : named;
      if (span(from, to) > MAX_SPAN_DAYS) from = shift(to, -(MAX_SPAN_DAYS - 1));
      return { key, from, to, today };
    }
    return { key, from: shift(today, -29), to: today, today };
  }

  if (key === "today") return { key, from: today, to: today, today };
  if (key === "yesterday") {
    const day = shift(today, -1);
    return { key, from: day, to: day, today };
  }
  if (key === "week") return { key, from: shift(today, -6), to: today, today };
  return { key: "month", from: shift(today, -29), to: today, today };
}

export type PeriodCounts = Readonly<{
  /** Canonical sales leads created in the selected period. */
  leads: number;
  /** Leads in the cohort that have a canonical linked student case. */
  handed: number;
}>;

export type PeriodFigures = Readonly<{
  counts: PeriodCounts;
  metrics: readonly Metric[];
  stages: readonly FunnelStage[];
}>;

export type PeriodTrend = Readonly<{
  series: readonly TrendSeries[];
  ticks: readonly string[];
  label: string;
}>;

export type PeriodDashboard = Readonly<{
  figures: PeriodFigures;
  trend: PeriodTrend | null;
}>;

type DatedLead = Readonly<{
  date: string;
  hour: number;
  handed: boolean;
}>;

function datedLead(row: PlatformSalesLeadRow): DatedLead {
  const createdAt = timestamp(row.createdAt);
  return {
    date: organizationDate(createdAt),
    hour: organizationHour(createdAt),
    handed: row.linkedStudentCaseCount > 0,
  };
}

function periodFigures(rows: readonly DatedLead[], period: Period): PeriodFigures {
  const cohort = rows.filter((row) => row.date >= period.from && row.date <= period.to);
  const counts: PeriodCounts = {
    leads: cohort.length,
    handed: cohort.filter((row) => row.handed).length,
  };

  return {
    counts,
    metrics: [
      { label: FUNNEL_STEP.leads, value: counts.leads, insteadOfDelta: null },
      { label: FUNNEL_STEP.handed, value: counts.handed, insteadOfDelta: null },
    ],
    stages: [
      { name: FUNNEL_STEP.leads, value: counts.leads },
      { name: FUNNEL_STEP.handed, value: counts.handed },
    ],
  };
}

function cumulative(values: readonly number[]): number[] {
  let total = 0;
  return values.map((value) => {
    total += value;
    return total;
  });
}

function assemble(
  labels: readonly string[],
  leadValues: readonly number[],
  handedValues: readonly number[],
  label: string,
): PeriodTrend | null {
  if (labels.length < 2) return null;
  const leads = cumulative(leadValues);
  const handed = cumulative(handedValues);
  if ([...leads, ...handed].every((value) => value === 0)) return null;

  const every = Math.max(1, Math.ceil(labels.length / 7));
  const ticks = labels.map((one, index) => (index % every === 0 ? one : ""));

  return {
    series: [
      { label: FUNNEL_STEP.leads, values: leads, emphasis: "primary" },
      { label: FUNNEL_STEP.handed, values: handed, emphasis: "secondary" },
    ],
    ticks,
    label,
  };
}

function hourlyTrend(
  rows: readonly DatedLead[],
  period: Period,
): PeriodTrend | null {
  const leads = Array.from({ length: 24 }, () => 0);
  const handed = Array.from({ length: 24 }, () => 0);
  for (const row of rows) {
    if (row.date !== period.from) continue;
    leads[row.hour] += 1;
    if (row.handed) handed[row.hour] += 1;
  }

  const labels = Array.from(
    { length: 24 },
    (_, hour) => `${String(hour).padStart(2, "0")}:00`,
  );
  return assemble(
    labels,
    leads,
    handed,
    rangeLabel(period.from, period.from, period.today),
  );
}

function dailyTrend(
  rows: readonly DatedLead[],
  period: Period,
  days: number,
): PeriodTrend | null {
  const step = days <= 31 ? 1 : days <= 182 ? 7 : 30;
  const whole = Math.floor(days / step);
  if (whole < 2) return null;

  const from = shift(period.to, -(whole * step - 1));
  const leads = Array.from({ length: whole }, () => 0);
  const handed = Array.from({ length: whole }, () => 0);
  for (const row of rows) {
    if (row.date < from || row.date > period.to) continue;
    const bucket = Math.floor((span(from, row.date) - 1) / step);
    if (bucket < 0 || bucket >= whole) {
      throw new Error("Canonical sales trend resolved outside its period.");
    }
    leads[bucket] += 1;
    if (row.handed) handed[bucket] += 1;
  }

  const [fromYear] = parts(from);
  const [nowYear] = parts(period.today);
  const labels = Array.from({ length: whole }, (_, index) => {
    const date = shift(from, index * step);
    return dayLabel(date, fromYear !== nowYear && index === 0);
  });

  return assemble(labels, leads, handed, rangeLabel(from, period.to, period.today));
}

/**
 * Both dashboard figures and the trend come from one canonical Supabase queue
 * read. The queue does not expose university-application evidence, so V3 does
 * not claim an "applied" cohort here; that metric can return only when a
 * canonical read projection supplies the fact.
 */
export async function readPeriodDashboard(
  actor: PlatformActor,
  period: Period,
): Promise<PeriodDashboard> {
  const rows = (await readAllCanonicalSalesLeads(actor)).map(datedLead);
  const days = span(period.from, period.to);
  return {
    figures: periodFigures(rows, period),
    trend: days === 1 ? hourlyTrend(rows, period) : dailyTrend(rows, period, days),
  };
}
