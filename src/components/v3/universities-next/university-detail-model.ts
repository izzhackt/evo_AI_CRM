/**
 * Карточка университета в «Новом виде»: срок подачи, начало и состояние каждого набора считает сервер (в поясе набора), как
 * и прежний вид (`intakeDeadlineView`, `intakeStartView`, `intakeStateLabel`); клиентский вид получает готовые слова.
 */
import type { UniversityContent } from "@/lib/platform-university-catalog";
import { UNIVERSITY_LEVEL_LABELS } from "@/lib/platform-university-catalog";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { catalogueZoneToday, formatCatalogueDay, intakeDeadlineView, intakeStartView, intakeStateLabel, programsWord, shownIntakes } from "@/lib/v3/university-view";

import type { ProgramView } from "./university-detail-types";

export function universityPlaceText(content: Pick<UniversityContent, "country" | "city" | "programs">, country: string): string {
  const count = content.programs.length;
  return `${country}${content.city ? ` · ${content.city}` : ""} · ${count} ${programsWord(count)}`;
}

export function universityPrograms(content: UniversityContent, now: Date): ProgramView[] {
  const today = dayInOrganizationTimezone(now);
  return content.programs.map((program) => ({
    id: program.id,
    title: program.title,
    level: UNIVERSITY_LEVEL_LABELS[program.level],
    duration: program.duration,
    language: program.language,
    summary: program.summary,
    sourceUrl: program.sourceUrl,
    intakes: shownIntakes(program.intakes).map((intake, index) => ({
      key: intake.id ?? String(index),
      label: intake.label,
      deadline: intakeDeadlineView(intake, now),
      start: intakeStartView(intake, catalogueZoneToday(intake.timezone, now) ?? today),
      state: intakeStateLabel(intake, now),
      verified: { dateTime: intake.verifiedOn, text: formatCatalogueDay(intake.verifiedOn, today) },
      sourceUrl: intake.sourceUrl,
    })),
  }));
}

export function universityVerified(content: Pick<UniversityContent, "verifiedOn">, now: Date) {
  return { dateTime: content.verifiedOn, text: formatCatalogueDay(content.verifiedOn, dayInOrganizationTimezone(now)) };
}
