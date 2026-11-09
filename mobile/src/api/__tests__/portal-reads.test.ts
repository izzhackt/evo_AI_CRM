import { PortalDecodeError } from "@/domain/portal-source";
import { countryChoiceWrite, readCountryChoice, readCscaHome, readFavorites, readNotifications, readOverview, readPreparations, saveCountryChoice } from "@/api/portal-reads";
import { RpcError } from "@/lib/rpc";
import { NOTIFICATION_ROW, OVERVIEW_ROW, PAYMENT_ROW } from "@/test-fixtures/rpc-rows";
import { STUDENT_CASE_ID, failure, fakeTransport, preparationRow, universityRow, uuidN } from "@/test-fixtures/universities";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("обзор дела", () => {
  it("читает обзор и начисления в режиме GET и собирает очередь", async () => {
    const { transport, calls } = fakeTransport({ student_portal_overview_v2: [OVERVIEW_ROW], student_portal_finance_v2: [PAYMENT_ROW] });
    const overview = await readOverview(transport);
    expect(overview?.studentActions).toHaveLength(2);
    expect(calls.map((c) => [c.name, c.get, c.args])).toEqual(
      expect.arrayContaining([
        ["student_portal_overview_v2", true, {}],
        ["student_portal_finance_v2", true, {}],
      ]),
    );
  });
  it("нет строки обзора: null (дело без плана)", async () => {
    const { transport } = fakeTransport({ student_portal_overview_v2: [], student_portal_finance_v2: [] });
    await expect(readOverview(transport)).resolves.toBeNull();
  });
  it("лишнее поле в строке: ошибка формы без данных", async () => {
    const { transport } = fakeTransport({ student_portal_overview_v2: [{ ...OVERVIEW_ROW, leaked: "x" }], student_portal_finance_v2: [] });
    await expect(readOverview(transport)).rejects.toBeInstanceOf(PortalDecodeError);
  });
  it("отказ сервера: RpcError без текста сервера", async () => {
    const { transport } = fakeTransport({ student_portal_overview_v2: failure("42501", 403), student_portal_finance_v2: [] });
    const error = await readOverview(transport).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).kind).toBe("forbidden");
    expect((error as RpcError).message).toBe("rpc:forbidden");
  });
});

describe("уведомления", () => {
  it("строгий разбор", async () => {
    const ok = fakeTransport({ student_portal_notifications_v2: [NOTIFICATION_ROW] });
    await expect(readNotifications(ok.transport)).resolves.toHaveLength(1);
    expect(ok.calls[0].get).toBe(true);
    const bad = fakeTransport({ student_portal_notifications_v2: [{ ...NOTIFICATION_ROW, extra: 1 }] });
    await expect(readNotifications(bad.transport)).rejects.toBeInstanceOf(PortalDecodeError);
  });
});

describe("выбор страны", () => {
  it("читает все источники выбора и отклоняет чужие формы", async () => {
    const saved = { country: "MY", source: "saved", savedAt: "2026-11-01T08:00:00+00:00" };
    await expect(readCountryChoice(fakeTransport({ student_country_choice_v1: saved }).transport)).resolves.toEqual(saved);
    const none = { country: null, source: "none", savedAt: null };
    await expect(readCountryChoice(fakeTransport({ student_country_choice_v1: none }).transport)).resolves.toEqual(none);
    for (const bad of [{ country: "FR", source: "saved", savedAt: "2026-11-01T08:00:00+00:00" }, { country: "MY", source: "saved" }, { country: "UNDECIDED", source: "case", savedAt: null }, null, []]) {
      await expect(readCountryChoice(fakeTransport({ student_country_choice_v1: bad }).transport)).rejects.toBeInstanceOf(PortalDecodeError);
    }
  });

  it("запись: повтор после обрыва шлёт тот же p_request_id и те же аргументы", async () => {
    const write = countryChoiceWrite("CN");
    expect(write.requestId).toMatch(UUID);
    const echo = { country: "CN", source: "saved", savedAt: "2026-11-09T08:00:00+00:00" };
    const { transport, calls } = fakeTransport({
      set_student_country_choice_v1: (_args: unknown, call: number) => (call === 1 ? new RpcError("transport") : echo),
    });
    await expect(saveCountryChoice(transport, write)).resolves.toEqual(echo);
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual({ p_country: "CN", p_request_id: write.requestId });
    expect(calls[1].args).toEqual(calls[0].args);
    expect(calls.every((c) => c.get === false)).toBe(true);
  });

  it("запись: новый выбор получает новый id", () => {
    expect(countryChoiceWrite("CN").requestId).not.toBe(countryChoiceWrite("CN").requestId);
  });

  it("запись: ответ должен подтвердить именно этот выбор", async () => {
    const write = countryChoiceWrite("CN");
    const other = { country: "MY", source: "saved", savedAt: "2026-11-09T08:00:00+00:00" };
    await expect(saveCountryChoice(fakeTransport({ set_student_country_choice_v1: other }).transport, write)).rejects.toBeInstanceOf(PortalDecodeError);
    const notSaved = { country: "CN", source: "application", savedAt: null };
    await expect(saveCountryChoice(fakeTransport({ set_student_country_choice_v1: notSaved }).transport, write)).rejects.toBeInstanceOf(PortalDecodeError);
  });

  it("запись: конфликт и отказ не повторяются", async () => {
    const { transport, calls } = fakeTransport({ set_student_country_choice_v1: failure("22023", 400) });
    const error = await saveCountryChoice(transport, countryChoiceWrite("CN")).catch((e: unknown) => e);
    expect((error as RpcError).kind).toBe("invalid");
    expect(calls).toHaveLength(1);
  });
});

describe("избранное", () => {
  const favorites = (n: number) => Array.from({ length: n }, (_, i) => ({ institutionId: uuidN(i + 1), createdAt: "2026-10-01T00:00:00+00:00" }));
  const byIds = (args: Record<string, unknown> | undefined) => ({
    items: ((args?.p_institution_ids as string[]) ?? []).map((id) => universityRow(Number(id.slice(-12)))).reverse(),
    nextOffset: null,
  });

  it("Главная: первые 4 карточки в порядке избранного, всего 35", async () => {
    const { transport, calls } = fakeTransport({ student_university_favorites_v1: favorites(35), student_university_catalog_by_ids_v1: byIds });
    const result = await readFavorites(transport, 4);
    expect(result.total).toBe(35);
    expect(result.items.map((u) => u.id)).toEqual([uuidN(1), uuidN(2), uuidN(3), uuidN(4)]);
    expect(calls.filter((c) => c.name === "student_university_catalog_by_ids_v1")).toHaveLength(1);
  });

  it("больше 30 id читается кусками по 30", async () => {
    const { transport, calls } = fakeTransport({ student_university_favorites_v1: favorites(35), student_university_catalog_by_ids_v1: byIds });
    const result = await readFavorites(transport, 120);
    expect(result.items).toHaveLength(35);
    const sizes = calls.filter((c) => c.name === "student_university_catalog_by_ids_v1").map((c) => (c.args?.p_institution_ids as string[]).length);
    expect(sizes).toEqual([30, 5]);
  });

  it("пустое избранное: карточки не запрашиваются", async () => {
    const { transport, calls } = fakeTransport({ student_university_favorites_v1: [] });
    await expect(readFavorites(transport, 4)).resolves.toEqual({ total: 0, items: [] });
    expect(calls).toHaveLength(1);
  });

  it("неполный ответ каталога: ошибка, а не укороченный список", async () => {
    const { transport } = fakeTransport({ student_university_favorites_v1: favorites(3), student_university_catalog_by_ids_v1: { items: [universityRow(1)], nextOffset: null } });
    await expect(readFavorites(transport, 4)).rejects.toBeInstanceOf(PortalDecodeError);
  });

  it("повтор id и чужая форма отклоняются", async () => {
    const dup = [favorites(1)[0], favorites(1)[0]];
    await expect(readFavorites(fakeTransport({ student_university_favorites_v1: dup }).transport, 4)).rejects.toBeInstanceOf(PortalDecodeError);
    await expect(readFavorites(fakeTransport({ student_university_favorites_v1: [{ institutionId: uuidN(1) }] }).transport, 4)).rejects.toBeInstanceOf(PortalDecodeError);
  });
});

describe("подготовки программ", () => {
  it("читает по делу студента; чужое дело в строке отклоняется", async () => {
    const { transport, calls } = fakeTransport({ student_catalog_preparations_v1: [preparationRow(1)] });
    await expect(readPreparations(transport, STUDENT_CASE_ID)).resolves.toHaveLength(1);
    expect(calls[0].args).toEqual({ p_student_case_id: STUDENT_CASE_ID });
    const other = fakeTransport({ student_catalog_preparations_v1: [{ ...preparationRow(1), studentCaseId: uuidN(9) }] });
    await expect(readPreparations(other.transport, STUDENT_CASE_ID)).rejects.toBeInstanceOf(PortalDecodeError);
  });
});

describe("CSCA", () => {
  it("чужая форма: ошибка разбора, а не обрыв экрана", async () => {
    await expect(readCscaHome(fakeTransport({ learning_track_home_v1: { track: "csca-math" } }).transport)).rejects.toBeInstanceOf(PortalDecodeError);
  });
  it("отказ сервера остаётся RpcError", async () => {
    const error = await readCscaHome(fakeTransport({ learning_track_home_v1: failure("42501", 403) }).transport).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
  });
  it("запрос идёт с p_track", async () => {
    const { transport, calls } = fakeTransport({ learning_track_home_v1: null });
    await readCscaHome(transport).catch(() => undefined);
    expect(calls[0].args).toEqual({ p_track: "csca-math" });
  });
});
