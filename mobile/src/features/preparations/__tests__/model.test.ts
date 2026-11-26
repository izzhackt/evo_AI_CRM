// Чистая модель экрана «Требования программы»: подписи сроков, выбор набора, правила заметок, состояние файла.
import { getPortalStrings } from "@web/lib/portal/i18n";

import {
  ASSOCIATION_REASONS,
  associationReasons,
  availabilityText,
  canInitializeRequirements,
  dottedDate,
  intakeDeadlineLine,
  itemDocumentView,
  materialDeadlineLine,
  programTime,
  requirementsNotes,
  selectedProgramOf,
} from "@/features/preparations/model";
import { PREPARATIONS_KY, PREPARATIONS_RU } from "@/i18n/strings-preparations";
import { preparationRow } from "@/test-fixtures/universities";

describe("сроки", () => {
  it("dottedDate: ГГГГ-ММ-ДД -> ДД.ММ.ГГГГ", () => {
    expect(dottedDate("2026-12-31")).toBe("31.12.2026");
    expect(dottedDate("2027-01-05")).toBe("05.01.2027");
  });

  it("срок документа: время и пояс только если они есть, как на странице веба", () => {
    expect(materialDeadlineLine({ date: "2026-12-31", time: "23:59", timezone: "Asia/Bishkek" })).toBe("31.12.2026, 23:59 (Asia/Bishkek)");
    expect(materialDeadlineLine({ date: "2026-12-31", time: null, timezone: "UTC" })).toBe("31.12.2026 (UTC)");
    expect(materialDeadlineLine({ date: "2026-12-31", time: null, timezone: null })).toBe("31.12.2026");
  });

  it("срок подачи набора: дата словом по языку, время и пояс независимы", () => {
    const intake = { applicationDeadline: "2027-05-01", deadlineTime: "18:00", timezone: "Asia/Shanghai" };
    expect(intakeDeadlineLine(intake, "ru")).toBe("1 мая 2027 г., 18:00 (Asia/Shanghai)");
    expect(intakeDeadlineLine({ ...intake, deadlineTime: null }, "ru")).toBe("1 мая 2027 г. (Asia/Shanghai)");
    expect(intakeDeadlineLine({ ...intake, timezone: null }, "ru")).toBe("1 мая 2027 г., 18:00");
    expect(intakeDeadlineLine({ applicationDeadline: null, deadlineTime: null, timezone: null }, "ru")).toBeNull();
    // Кыргызская форма даётся самой средой; важно, что год и пояс на месте и строка не пуста.
    expect(intakeDeadlineLine(intake, "ky")).toMatch(/2027.*18:00 \(Asia\/Shanghai\)$/u);
  });

  it("момент по Бишкеку (UTC+6) с подписью пояса, как у сайта: «7 окт. 2026 г., 16:05 (Бишкек)»", () => {
    expect(programTime("2026-10-07T10:05:00+00:00")).toBe("7 окт. 2026 г., 16:05 (Бишкек)");
    expect(programTime("2026-10-07T20:30:00-04:00")).toBe("8 окт. 2026 г., 06:30 (Бишкек)");
    expect(programTime("не дата")).toBe("не дата (Бишкек)");
  });

  it("совпадает с `ProgramDocumentTime` сайта (dateStyle medium, timeStyle short, Asia/Bishkek) в любой день года и в полночь", () => {
    // Ровно та форма, которой пользуется сайт: компонент не импортируется (React DOM), формат повторён строкой в строку.
    const web = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bishkek" });
    const moments = ["2026-01-01T18:00:00Z", "2026-02-28T19:00:00Z", "2026-05-09T00:00:00Z", "2026-08-31T18:30:00Z", "2026-10-07T10:05:00+00:00", "2026-12-31T23:59:59Z", "2027-03-15T03:07:00Z"];
    for (const moment of moments) expect(programTime(moment)).toBe(`${web.format(new Date(moment))} (Бишкек)`);
  });

  it("подпись пояса одна и в русском, и в кыргызском словаре (сайт пишет одно слово)", () => {
    expect(PREPARATIONS_KY["prep.timeZone"]).toBe(PREPARATIONS_RU["prep.timeZone"]);
  });
});

describe("программа и набор", () => {
  it("находятся по идентификаторам выбранной программы", () => {
    const row = preparationRow(1) as unknown as Parameters<typeof selectedProgramOf>[0];
    const { program, intake } = selectedProgramOf(row);
    expect(program?.title).toBe("Информатика");
    expect(intake?.label).toBe("Осень 2027");
  });

  it("программы или набора, которых нет в карточке, нет и в ответе (экран падает на название вуза)", () => {
    const row = preparationRow(1) as unknown as Parameters<typeof selectedProgramOf>[0];
    expect(selectedProgramOf({ ...row, programId: "missing" })).toEqual({ program: undefined, intake: undefined });
    expect(selectedProgramOf({ ...row, intakeId: "99999999-9999-4999-8999-999999999999" }).intake).toBeUndefined();
  });
});

describe("правила показа", () => {
  it("список можно открыть только при активном сопровождении и статусе «Собираем документы»", () => {
    expect(canInitializeRequirements(true, "preparation")).toBe(true);
    expect(canInitializeRequirements(false, "preparation")).toBe(false);
    for (const status of ["ready", "submitted", "under_review", "offer", "rejected", "enrolled", "withdrawn", "closed"] as const) {
      expect(canInitializeRequirements(true, status)).toBe(false);
    }
  });

  it("заметки: «начальный список» у стартового списка и у неоткрытого списка при праве открыть; «подтверждён» у подтверждённого", () => {
    const starter = { origin: "evo_starter", state: "initialized", configurationState: "needs_confirmation" } as never;
    const confirmed = { origin: "staff_confirmed", state: "initialized", configurationState: "confirmed" } as never;
    const empty = { origin: null, state: "uninitialized", configurationState: null } as never;
    const legacy = { origin: null, state: "needs_configuration", configurationState: null } as never;
    expect(requirementsNotes(starter, false)).toEqual({ starter: true, confirmed: false });
    expect(requirementsNotes(confirmed, true)).toEqual({ starter: false, confirmed: true });
    expect(requirementsNotes(empty, true)).toEqual({ starter: true, confirmed: false });
    expect(requirementsNotes(empty, false)).toEqual({ starter: false, confirmed: false });
    expect(requirementsNotes(legacy, true)).toEqual({ starter: false, confirmed: false });
    expect(requirementsNotes(null, true)).toEqual({ starter: false, confirmed: false });
  });

  it("причины связи документа: только четыре, остальные относятся к самому файлу", () => {
    expect([...ASSOCIATION_REASONS]).toEqual(["slot_missing", "slot_removed", "application_link_missing", "slot_metadata_changed"]);
    expect(associationReasons({ unavailableReasons: ["file_missing", "slot_removed", "integrity_pending", "slot_metadata_changed"] })).toEqual(["slot_removed", "slot_metadata_changed"]);
    expect(associationReasons({ unavailableReasons: ["file_missing"] })).toEqual([]);
  });
});

describe("файл у требования", () => {
  const draft = { uploadContextId: "u", file: { documentVersionId: "v2" } } as never;
  const submitted = (version: string) => ({ submissionId: "s", file: { documentVersionId: version } }) as never;

  it("ничего нет -> «Файл ещё не загружен»", () => {
    expect(itemDocumentView({ savedDraft: null, submission: null })).toMatchObject({ noFile: true, unsubmittedDraft: null, newerDraft: false });
  });

  it("сохранён, не отправлен", () => {
    expect(itemDocumentView({ savedDraft: draft, submission: null })).toMatchObject({ noFile: false, unsubmittedDraft: draft, newerDraft: false });
  });

  it("сохранённый файл той же версии, что отправлен, не считается неотправленным", () => {
    expect(itemDocumentView({ savedDraft: draft, submission: submitted("v2") })).toMatchObject({ noFile: false, unsubmittedDraft: null, newerDraft: false });
  });

  it("есть отправленный и более новый сохранённый файл", () => {
    expect(itemDocumentView({ savedDraft: draft, submission: submitted("v1") })).toMatchObject({ unsubmittedDraft: draft, newerDraft: true });
  });

  it("причина недоступности файла: известная своим текстом, неизвестная общей строкой", () => {
    for (const lang of ["ru", "ky"] as const) {
      const strings = getPortalStrings("programDocuments", lang);
      expect(availabilityText(strings, "malware_infected")).toBe(strings["availability.malware_infected"]);
      expect(availabilityText(strings, "scan_proof_unavailable")).toBe(strings["availability.scan_proof_unavailable"]);
      expect(availabilityText(strings, "неизвестная причина")).toBe(strings.downloadFailed);
    }
  });
});
