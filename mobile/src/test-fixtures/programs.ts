// Синтетические программы и карточка вуза с ними для проверок подбора и добавления. Названия придуманы; английские названия
// подобраны так, чтобы направление выводилось из них по правилам веба (program-facets.ts).
import type { UniversityLevel, UniversityProgram } from "@web/lib/platform-university-catalog";

import { STUDENT_CASE_ID, uuidN } from "@/test-fixtures/universities";

export const INTAKE_BASE = "11111111-1111-4111-8111-";

/** Идентификатор набора номер n: настоящий UUID, как требует разборщик каталога. */
export const intakeUuid = (n: number) => `${INTAKE_BASE}${String(n).padStart(12, "0")}`;

type Spec = Readonly<{
  id: string;
  title: string;
  level?: UniversityLevel;
  duration?: string | null;
  language?: string | null;
  summary?: string;
  /** Наборы: подпись, месяц начала (`2027-09`), срок подачи, статус. */
  intakes?: readonly Readonly<{ label: string; startMonth?: string | null; deadline?: string | null; status?: string; n: number }>[];
}>;

/** Номера наборов по умолчанию: у разных программ одного вуза идентификаторы наборов разные (иначе разборщик отвергает карточку). */
let defaultIntake = 500;

/** Программа в форме строгого разборщика каталога. */
export function program(spec: Spec): UniversityProgram {
  return {
    id: spec.id,
    title: spec.title,
    level: spec.level ?? "bachelor",
    duration: spec.duration === undefined ? "3 года" : spec.duration,
    language: spec.language === undefined ? "Английский" : spec.language,
    summary: spec.summary ?? `Описание программы ${spec.title}.`,
    sourceUrl: `https://example.org/${spec.id}`.replace("example.org", "uni.edu.my"),
    intakes: (spec.intakes ?? [{ label: "Сентябрь 2027", startMonth: "2027-09", deadline: "2099-05-01", n: ++defaultIntake }]).map((intake) => ({
      id: intakeUuid(intake.n),
      label: intake.label,
      startDate: null,
      startMonth: intake.startMonth === undefined ? "2027-09" : intake.startMonth,
      applicationDeadline: intake.deadline === undefined ? "2099-05-01" : intake.deadline,
      deadlineTime: null,
      timezone: null,
      status: (intake.status ?? "open") as UniversityProgram["intakes"][number]["status"],
      note: "",
      sourceUrl: "https://uni.edu.my/intake",
      verifiedOn: "2026-10-01",
    })),
  };
}

/**
 * Карточка вуза с набором программ в форме `student_university_detail_v1` (страна Малайзия, без стоимости и фото). `preparations`:
 * `null` - список не читается, массив - уже добавленные программы этого вуза.
 */
export function detailBody(programs: readonly UniversityProgram[], extra: { preparations?: unknown; id?: string; version?: number } = {}) {
  const id = extra.id ?? uuidN(1);
  return {
    university: {
      id,
      version: extra.version ?? 3,
      publishedAt: "2026-10-01T00:00:00+00:00",
      content: {
        name: "Университет Зета",
        country: "MY",
        city: "Куала-Лумпур",
        overview: "Описание университета для теста.",
        websiteUrl: "https://uni.edu.my/",
        sourceUrl: "https://uni.edu.my/source",
        verifiedOn: "2026-10-01",
        notes: "",
        photoKey: null,
        programs,
      },
    },
    country: { code: "MY", name: { ru: "Малайзия", ky: "Малайзия" } },
    city: null,
    favored: false,
    openConsultation: null,
    preparations: extra.preparations === undefined ? { studentCaseId: STUDENT_CASE_ID, items: [] } : extra.preparations,
    costs: null,
  };
}

/** Все направления и несколько уровней, месяцев и длительностей: 12 программ, на которых видны все поля подбора. */
export function twelvePrograms(): readonly UniversityProgram[] {
  return [
    program({ id: "cs-b", title: "Bachelor of Computer Science", level: "bachelor", duration: "3 года", intakes: [{ label: "Февраль / сентябрь", startMonth: "2027-09", n: 11 }] }),
    program({ id: "ai-m", title: "Master of Artificial Intelligence", level: "master", duration: "2 года", intakes: [{ label: "Октябрь 2027", startMonth: "2027-10", n: 12 }] }),
    program({ id: "mba", title: "Master of Business Administration", level: "master", duration: "1,5 года", intakes: [{ label: "Июль 2027", startMonth: "2027-07", n: 13 }] }),
    program({ id: "fin-b", title: "Bachelor of Finance", level: "bachelor", duration: "3 года", intakes: [{ label: "Сентябрь 2027", startMonth: "2027-09", n: 14 }] }),
    program({ id: "civil-b", title: "Bachelor of Civil Engineering", level: "bachelor", duration: "4 года", intakes: [{ label: "Сентябрь 2027", startMonth: "2027-09", n: 15 }] }),
    program({ id: "nurse-d", title: "Diploma in Nursing", level: "diploma", duration: "3 года", intakes: [{ label: "Январь 2028", startMonth: "2028-01", n: 16 }] }),
    program({ id: "law-b", title: "Bachelor of Laws", level: "bachelor", duration: "4 года", intakes: [{ label: "Сентябрь 2027", startMonth: "2027-09", n: 17 }] }),
    program({ id: "design-b", title: "Bachelor of Graphic Design", level: "bachelor", duration: "3 года", intakes: [{ label: "Сентябрь 2027", startMonth: "2027-09", n: 18 }] }),
    program({ id: "fdn", title: "Foundation in Science", level: "foundation", duration: "1 год", intakes: [{ label: "Июль 2027", startMonth: "2027-07", n: 19 }] }),
    program({ id: "edu-m", title: "Master of Education", level: "master", duration: "2 года", intakes: [{ label: "Октябрь 2027", startMonth: "2027-10", n: 20 }] }),
    program({ id: "tour-b", title: "Bachelor of Tourism Management", level: "bachelor", duration: "3 года", intakes: [{ label: "Сентябрь 2027", startMonth: "2027-09", n: 21 }] }),
    // без известного месяца и длительности: такую программу выбор месяца и длительности не прячет
    program({ id: "unknown-b", title: "Bachelor of Quiet Practice", level: "bachelor", duration: null, intakes: [{ label: "Уточняется", startMonth: null, deadline: null, status: "unknown", n: 22 }] }),
  ];
}

/** Строка `student_catalog_preparations_v1`: уже добавленная программа (заявка номер n) вуза из `detailBody`. */
export function preparationItem(spec: { n: number; programs: readonly UniversityProgram[]; programId: string; status?: string; intakeIndex?: number; id?: string }) {
  const program = spec.programs.find((entry) => entry.id === spec.programId)!;
  const intake = program.intakes[spec.intakeIndex ?? 0]!;
  return {
    applicationId: uuidN(spec.n, "bbbbbbbb"),
    studentCaseId: STUDENT_CASE_ID,
    institutionId: spec.id ?? uuidN(1),
    programId: program.id,
    intakeId: intake.id,
    publicationId: uuidN(spec.n, "cccccccc"),
    publicationVersion: 3,
    catalogLevel: program.level,
    applicationDegree: program.level,
    selectedAt: "2026-11-09T08:00:00+00:00",
    deadlineStateAtSelection: "confirmed",
    applicationStatus: spec.status ?? "preparation",
    applicationVersion: "1",
    content: detailBody(spec.programs, { id: spec.id }).university.content,
  };
}

/** Ответ `student_select_catalog_intake_v1`: квитанция о выборе (то, что вернул бы сервер на этот запрос). */
export function selectReceipt(item: ReturnType<typeof preparationItem>, args: Record<string, unknown> | undefined) {
  const { applicationStatus, applicationVersion, content, ...binding } = item;
  void applicationStatus;
  void applicationVersion;
  void content;
  return { ...binding, requestId: args?.p_request_id };
}

/** Ответ `student_application_documents_v1` без документов: список документов программы ещё не открыт (`uninitialized`) или требует настройки. */
export function documentsBody(applicationId: string, state: "uninitialized" | "needs_configuration" = "uninitialized") {
  return {
    protocolVersion: 1,
    studentCaseId: STUDENT_CASE_ID,
    applicationId,
    requirements: {
      protocolVersion: 2,
      studentCaseId: STUDENT_CASE_ID,
      applicationId,
      state,
      revisionId: null,
      revisionVersion: null,
      origin: null,
      configurationState: null,
      initializedAt: null,
      configurationReasons: state === "uninitialized" ? [] : ["legacy_case_checklist"],
      items: [],
    },
    items: [],
  };
}

/** Ответ `student_initialize_application_requirements_v1`: список из двух начальных документов EVO открыт. */
export function initializeReceipt(applicationId: string, args: Record<string, unknown> | undefined) {
  return {
    studentCaseId: STUDENT_CASE_ID,
    applicationId,
    requestId: args?.p_request_id,
    revisionId: uuidN(70, "dddddddd"),
    revisionVersion: "1",
    origin: "evo_starter",
    configurationState: "needs_confirmation",
    initializedAt: "2026-11-09T08:00:05+00:00",
    items: [
      { requirementItemId: uuidN(71, "dddddddd"), requirementKey: "evo.photo.v1", documentSlotId: uuidN(72, "dddddddd") },
      { requirementItemId: uuidN(73, "dddddddd"), requirementKey: "evo.passport.v1", documentSlotId: uuidN(74, "dddddddd") },
    ],
  };
}
