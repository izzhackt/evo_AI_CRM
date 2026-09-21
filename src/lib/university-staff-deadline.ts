import {
  universityDate,
  universityPublicUrl,
  type UniversityFilters,
  type UniversityIntake,
  type UniversityProgram,
} from "./platform-university-catalog.ts";

export type StaffUniversityDeadline = Readonly<{
  program: UniversityProgram;
  intake: UniversityIntake;
  applicationDeadline: string;
  sameDateCount: number;
}>;

/** Display only: the earliest published calendar date, not an absolute instant
 * or admission eligibility. Keep the exact programme/intake and its provenance. */
export function staffUniversityDeadline(
  programs: readonly UniversityProgram[],
  level: UniversityFilters["level"],
  now: Date,
): StaffUniversityDeadline | null {
  if (!Number.isFinite(now.getTime())) return null;
  const candidates: Array<StaffUniversityDeadline & { intakeIndex: number }> = [];
  for (const program of programs) {
    if (level && program.level !== level) continue;
    for (const [intakeIndex, intake] of program.intakes.entries()) {
      const { applicationDeadline, deadlineTime, timezone, status, verifiedOn } = intake;
      if ((status !== "open" && status !== "announced")
        || !universityDate(applicationDeadline) || !universityDate(verifiedOn)
        || !universityPublicUrl(intake.sourceUrl) || !timezone
        || (!(timezone === "UTC" || timezone === "GMT") && !/^[A-Za-z_]+\/[A-Za-z0-9_+/-]+$/.test(timezone))
        || /^(posix|right)\//.test(timezone)
        || (deadlineTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(deadlineTime))) continue;

      // Match universityIntakeLabel's zone-local day and inclusive minute
      // boundary. A date without a time stays a date; never invent midnight.
      let parts: Intl.DateTimeFormatPart[];
      try {
        parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        }).formatToParts(now);
      } catch { continue; }
      const at = (key: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === key)?.value ?? "";
      const day = `${at("year")}-${at("month")}-${at("day")}`;
      if (verifiedOn > day || applicationDeadline < day
        || (applicationDeadline === day && deadlineTime !== null && deadlineTime <= `${at("hour")}:${at("minute")}`)) continue;
      candidates.push({ program, intake, applicationDeadline, intakeIndex, sameDateCount: 0 });
    }
  }
  candidates.sort((a, b) => {
    if (a.applicationDeadline !== b.applicationDeadline) return a.applicationDeadline < b.applicationDeadline ? -1 : 1;
    if (a.program.id !== b.program.id) return a.program.id < b.program.id ? -1 : 1;
    return a.intakeIndex - b.intakeIndex;
  });
  const first = candidates[0];
  if (!first) return null;
  return {
    program: first.program, intake: first.intake, applicationDeadline: first.applicationDeadline,
    sameDateCount: candidates.filter((entry) => entry.applicationDeadline === first.applicationDeadline).length - 1,
  };
}
