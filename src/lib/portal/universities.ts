/**
 * Чистые помощники портального каталога «Атлас» (PORT-3a, план §6 «Каталог»/
 * «Карта», дизайн-контракт docs/design/portal/design-contract.md).
 *
 * Доменные типы и значения приходят из shared
 * `src/lib/platform-university-catalog.ts`; строки — только через портальный
 * словарь (`src/lib/portal/i18n.ts`), staff-словари сюда не импортируются.
 * Файл клиент-безопасный: без server-only и без Supabase.
 */
import type { Locale } from "../i18n-data.ts";
import {
  UNIVERSITY_LEVELS,
  type UniversityContent,
  type UniversityIntake,
  type UniversityLevel,
} from "../platform-university-catalog.ts";

/**
 * Точка на карте: сериализуемый DTO от серверной страницы к клиентской карте.
 * `place` — уже локализованная строка «город · страна» (локаль знает сервер).
 */
export type UniversityMapPin = Readonly<{
  id: string;
  name: string;
  place: string;
  lat: number;
  lng: number;
}>;

export type PortalIntakeStatusKey =
  | "intakeStatus.closed"
  | "intakeStatus.needsConfirmation"
  | "intakeStatus.open"
  | "intakeStatus.announced"
  | "intakeStatus.unclear";

export function universityLevelKey(level: UniversityLevel): `level.${UniversityLevel}` {
  return `level.${level}`;
}

/** Уникальные уровни программ карточки в доменном порядке шкалы уровней. */
export function universityLevels(content: UniversityContent): readonly UniversityLevel[] {
  const present = new Set(content.programs.map((program) => program.level));
  return UNIVERSITY_LEVELS.filter((level) => present.has(level));
}

function localeTag(locale: Locale): "ky" | "ru" {
  return locale === "ky" ? "ky" : "ru";
}

/**
 * Название страны по ISO-коду. KY берётся из Intl (CLDR содержит ky);
 * если среда не даёт локализованное имя — честный фолбэк на RU, затем код.
 */
export function universityCountryLabel(code: string, locale: Locale): string {
  const tags: readonly string[] = locale === "ky" ? ["ky", "ru"] : ["ru"];
  for (const tag of tags) {
    try {
      const name = new Intl.DisplayNames([tag], { type: "region" }).of(code);
      if (name && name !== code) return name;
    } catch {
      // Локаль недоступна в этой среде — пробуем следующую.
    }
  }
  return code;
}

export function universityDateLabel(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function universityMonthLabel(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}-01T12:00:00Z`));
}

/** Confirmed deadlines use the intake's own timezone; uncertain facts never imply expiry. */
export function universityIntakeStatusKey(
  intake: UniversityIntake,
  now = new Date(),
): PortalIntakeStatusKey {
  if (intake.status === "closed") return "intakeStatus.closed";
  if (intake.status === "needs_reconfirmation") return "intakeStatus.needsConfirmation";
  if (intake.status === "unknown") return "intakeStatus.unclear";
  if (intake.applicationDeadline) {
    if (!intake.timezone || (!(intake.timezone === "UTC" || intake.timezone === "GMT")
      && !/^[A-Za-z_]+\/[A-Za-z0-9_+/-]+$/.test(intake.timezone))
      || /^(posix|right)\//.test(intake.timezone)) return "intakeStatus.needsConfirmation";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: intake.timezone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(now);
      const at = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
      const day = `${at("year")}-${at("month")}-${at("day")}`;
      if (intake.applicationDeadline < day || (intake.applicationDeadline === day
        && intake.deadlineTime && intake.deadlineTime <= `${at("hour")}:${at("minute")}`)) return "intakeStatus.closed";
    } catch {
      return "intakeStatus.needsConfirmation";
    }
  }
  return intake.status === "open" ? "intakeStatus.open" : "intakeStatus.announced";
}

/**
 * Ближайший будущий рубеж наборов карточки для строки «Ближайший набор»:
 * сначала ближайший срок подачи, иначе ближайшее начало обучения. Считаются
 * только наборы со статусом open/announced — непроверенные даты не
 * показываются как факт (план §6, «Каталог и материалы»).
 */
export type NearestUniversityIntake = Readonly<{
  kind: "deadline" | "start" | "startMonth";
  value: string;
}>;

export function nearestUniversityIntake(
  content: UniversityContent,
  now: Date,
): NearestUniversityIntake | null {
  const today = now.toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  let deadline: string | null = null;
  let start: string | null = null;
  let startMonth: string | null = null;
  for (const program of content.programs) {
    for (const intake of program.intakes) {
      if (intake.status !== "open" && intake.status !== "announced") continue;
      if (
        intake.applicationDeadline
        && intake.applicationDeadline >= today
        && (deadline === null || intake.applicationDeadline < deadline)
      ) deadline = intake.applicationDeadline;
      if (
        intake.startDate
        && intake.startDate >= today
        && (start === null || intake.startDate < start)
      ) start = intake.startDate;
      if (
        !intake.startDate
        && intake.startMonth
        && intake.startMonth >= thisMonth
        && (startMonth === null || intake.startMonth < startMonth)
      ) startMonth = intake.startMonth;
    }
  }
  if (deadline !== null) return { kind: "deadline", value: deadline };
  if (start !== null && (startMonth === null || start.slice(0, 7) <= startMonth)) {
    return { kind: "start", value: start };
  }
  if (startMonth !== null) return { kind: "startMonth", value: startMonth };
  return null;
}
