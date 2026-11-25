// Чистая модель экрана «Требования программы»: подписи сроков, выбор программы и набора из карточки каталога, правила
// показа заметок, состояние файла у одного требования. Порт чистых частей `ApplicationRequirementsUI.tsx`,
// `ProgramDocumentItem.tsx` и `ProgramDocumentEvidence.tsx` веба; без React и без нативных модулей.
import type { UniversityIntake, UniversityProgram } from "@web/lib/platform-university-catalog";
import type { PlatformApplicationStatus } from "@web/lib/platform-application-contract";
import type {
  ApplicationDocumentItemState,
  ApplicationDocumentSubmission,
  ApplicationDocumentUpload,
} from "@web/lib/portal/application-documents";
import type { CatalogPreparation } from "@web/lib/portal/catalog-preparations";
import type { PortalStrings } from "@web/lib/portal/i18n";
import type { ApplicationRequirementDeadline, ApplicationRequirementItemV2, ApplicationRequirementsV2 } from "@web/lib/portal/application-requirements-v2";
import { universityDateLabel } from "@web/lib/portal/universities";

import { formatPortalTimestamp } from "@/domain/presentation";
import type { Lang } from "@/i18n";

/** Куда ведёт «К моему поступлению»: «Мои программы» на «Главной» (веб: `/portal?view=programs#list`). */
export const PROGRAMS_LIST_ROUTE = "/home?list=programs";

/** `2026-12-31` -> `31.12.2026` (веб: `date.split("-").reverse().join(".")`). */
export function dottedDate(value: string): string {
  return value.split("-").reverse().join(".");
}

/** Срок документа: `31.12.2026, 23:59 (Asia/Bishkek)`; время и пояс только если они есть (веб, `Requirement`). */
export function materialDeadlineLine(deadline: Pick<ApplicationRequirementDeadline, "date" | "time" | "timezone">): string {
  return `${dottedDate(deadline.date)}${deadline.time ? `, ${deadline.time}` : ""}${deadline.timezone ? ` (${deadline.timezone})` : ""}`;
}

/** Срок подачи набора из шапки программы: `1 мая 2027 г., 23:59 (Asia/Bishkek)`; пояс и время независимы, как на странице веба. */
export function intakeDeadlineLine(intake: Pick<UniversityIntake, "applicationDeadline" | "deadlineTime" | "timezone">, lang: Lang): string | null {
  if (!intake.applicationDeadline) return null;
  return `${universityDateLabel(intake.applicationDeadline, lang)}${intake.deadlineTime ? `, ${intake.deadlineTime}` : ""}${intake.timezone ? ` (${intake.timezone})` : ""}`;
}

/** Момент по Бишкеку (дата, время) с подписью пояса: веб всегда пишет «(Бишкек)», в обоих языках. */
export function programTime(value: string): string {
  return `${formatPortalTimestamp(value) ?? value} (Бишкек)`;
}

/** Программа и набор, выбранные студентом (веб: `saved.content.programs.find`, `program.intakes.find`). */
export function selectedProgramOf(saved: Pick<CatalogPreparation, "content" | "programId" | "intakeId">): Readonly<{
  program: UniversityProgram | undefined;
  intake: UniversityIntake | undefined;
}> {
  const program = saved.content.programs.find((entry) => entry.id === saved.programId);
  return { program, intake: program?.intakes.find((entry) => entry.id === saved.intakeId) };
}

/** Причины, по которым связь документа с программой недоступна (показываются у требования, остальные - у файла). */
export const ASSOCIATION_REASONS = ["slot_missing", "slot_removed", "application_link_missing", "slot_metadata_changed"] as const;
export type AssociationReason = (typeof ASSOCIATION_REASONS)[number];

export function associationReasons(item: Pick<ApplicationRequirementItemV2, "unavailableReasons">): readonly AssociationReason[] {
  return item.unavailableReasons.filter((reason): reason is AssociationReason => (ASSOCIATION_REASONS as readonly string[]).includes(reason));
}

/**
 * Можно ли открыть начальный список документов: дело на сопровождении (`canSelectPrograms`: `active` и кабинет
 * активирован, как в веб-странице) и программа ещё на подготовке (`ApplicationRequirementsUI.canInitialize`).
 */
export function canInitializeRequirements(canSelectPrograms: boolean, applicationStatus: PlatformApplicationStatus): boolean {
  return canSelectPrograms && applicationStatus === "preparation";
}

/** Какие заметки стоят над списком (веб: `starter`, `confirmed`). */
export function requirementsNotes(current: ApplicationRequirementsV2 | null, eligible: boolean): Readonly<{ starter: boolean; confirmed: boolean }> {
  return {
    starter: current?.origin === "evo_starter" || (current?.state === "uninitialized" && eligible),
    confirmed: current?.configurationState === "confirmed",
  };
}

/** Строка о недоступности файла: известная причина своим текстом, неизвестная - общей строкой `downloadFailed` (веб, `ProgramFileEvidence`). */
export function availabilityText(strings: PortalStrings<"programDocuments">, reason: string): string {
  const key = `availability.${reason}` as keyof typeof strings;
  return strings[key] ?? strings.downloadFailed;
}

export type ItemDocumentView = Readonly<{
  /** Сохранённый, но не отправленный файл (его версия не совпадает с версией отправленного). */
  unsubmittedDraft: ApplicationDocumentUpload | null;
  submission: ApplicationDocumentSubmission | null;
  /** Ничего нет: «Файл ещё не загружен». */
  noFile: boolean;
  /** Есть и отправленный документ, и более новый сохранённый файл. */
  newerDraft: boolean;
}>;

/** Что студент видит у одного требования, пока действий нет (`ProgramDocumentItemSnapshot`: `unsubmittedDraft`). */
export function itemDocumentView(state: Pick<ApplicationDocumentItemState, "savedDraft" | "submission">): ItemDocumentView {
  const draft = state.savedDraft;
  const unsubmittedDraft = draft && draft.file.documentVersionId !== state.submission?.file.documentVersionId ? draft : null;
  return {
    unsubmittedDraft,
    submission: state.submission,
    noFile: unsubmittedDraft === null && state.submission === null,
    newerDraft: unsubmittedDraft !== null && state.submission !== null,
  };
}
