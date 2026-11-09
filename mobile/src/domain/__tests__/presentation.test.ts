import { getPortalStrings } from "@web/lib/portal/i18n";

import { ADMISSION_STAGE_PATH, actionTarget, actionTitle, allDayDate, evoActionDueLabel, evoActionStatusLabel, formatPortalDeadline, formatPortalMoney, linkTarget, notificationRoute, portalNotificationText, stageIndex, stageLabel } from "@/domain/presentation";
import { normalizeStudentPortalOverview } from "@/domain/portal-source";

import { OVERVIEW_ROW, SLOT_ID } from "@/test-fixtures/rpc-rows";

const ru = getPortalStrings("admission", "ru");
const ky = getPortalStrings("admission", "ky");

describe("форматы", () => {
  it("срок показывается датой по Бишкеку (UTC+6)", () => {
    // 20:00 UTC уже следующие сутки в Бишкеке.
    expect(formatPortalDeadline("2026-11-20T20:00:00+00:00")).toBe("21.11.2026");
    expect(formatPortalDeadline("2026-11-20T17:59:00+00:00")).toBe("20.11.2026");
    expect(formatPortalDeadline(null)).toBeNull();
    expect(formatPortalDeadline("не дата")).toBeNull();
  });
  it("сумма: сомы словом, целые без копеек", () => {
    expect(formatPortalMoney(10000, "KGS")).toBe("100 сом");
    expect(formatPortalMoney(10050, "KGS")).toBe("100,50 сом");
    expect(formatPortalMoney(10000, "USD")).toContain("100");
    expect(formatPortalMoney(10000, "USD")).toContain("$");
  });
  it("дата без времени", () => {
    expect(allDayDate("2026-09-13")).toBe("13.09.2026");
    expect(allDayDate("2026-9-13")).toBeNull();
    expect(allDayDate(null)).toBeNull();
  });
});

describe("действия дела", () => {
  const overview = normalizeStudentPortalOverview(OVERVIEW_ROW);
  it("подпись и цель", () => {
    const action = overview.studentAction!;
    expect(actionTitle(action, ru)).toBe("Замените документ: Паспорт");
    expect(actionTitle(action, ky)).toContain("Паспорт");
    expect(actionTarget(action)).toEqual({ route: "/documents", slotId: SLOT_ID });
    expect(actionTarget({ kind: "payment", label: "x", dueAt: null, amountMinor: 1, currency: "USD" })).toEqual({ route: "/payments", slotId: null });
  });
  it("задача EVO: срок датой или временем, статус словарём", () => {
    expect(evoActionDueLabel(overview.evoAction!)).toBe("13.09.2026");
    expect(evoActionStatusLabel(overview.evoAction!, ru)).toBe("в работе");
    expect(evoActionDueLabel({ ...overview.evoAction!, dueOn: null, dueAt: "2026-11-20T20:00:00+00:00" })).toBe("21.11.2026");
  });
});

describe("этапы дела", () => {
  it("десять шагов дорожки без closed", () => {
    expect(ADMISSION_STAGE_PATH).toHaveLength(10);
    expect(ADMISSION_STAGE_PATH).not.toContain("closed");
  });
  it("подпись известного этапа, нестандартного и пустого", () => {
    expect(stageLabel("documents", ru)).toBe(ru["stage.documents"]);
    expect(stageLabel(" documents ", ru)).toBe(ru["stage.documents"]);
    expect(stageLabel("closed", ru)).toBe(ru["stage.closed"]);
    expect(stageLabel("Подготовка документов", ru)).toBe(ru.stageCustom);
    expect(stageLabel("  ", ru)).toBeNull();
  });
  it("индекс на дорожке", () => {
    expect(stageIndex("contract_confirmed")).toBe(0);
    expect(stageIndex("completed")).toBe(9);
    expect(stageIndex("closed")).toBe(-1);
    expect(stageIndex("что-то своё")).toBe(-1);
    expect(stageIndex(null)).toBe(-1);
  });
});

describe("уведомления и ссылки", () => {
  it.each([
    [{ category: "document", eventCode: "correction_required" }, "/documents"],
    [{ category: "payment_due", eventCode: "x" }, "/payments"],
    [{ category: "anything", eventCode: "case_chat_message" }, "/messages/chat"],
    [{ category: "case", eventCode: "case_help_answer" }, "/messages/updates"],
    [{ category: "application", eventCode: "application_package_review" }, "/messages/updates"],
    [{ category: "application", eventCode: "application_document_review" }, "/messages/updates"],
    [{ category: "novelty", eventCode: "new_thing" }, "/overview"],
  ])("%j -> %s", (input, route) => expect(notificationRoute(input)).toBe(route));

  it("сообщение команды подписано на языке студента", () => {
    expect(portalNotificationText({ eventCode: "case_chat_message", subjectLabel: "текст по-русски", detail: "x" }, ky)).toEqual({
      title: ky.caseChatNotificationTitle,
      detail: ky.caseChatNotificationDetail,
    });
    expect(portalNotificationText({ eventCode: "other", subjectLabel: "Паспорт", detail: null }, ru)).toEqual({ title: "Паспорт", detail: null });
  });

  it("ссылки контента: вкладка, браузер или никуда", () => {
    expect(linkTarget("/portal/csca")).toEqual({ kind: "route", route: "/csca" });
    expect(linkTarget("/portal")).toEqual({ kind: "route", route: "/overview" });
    expect(linkTarget("https://www.csca.cn/")).toEqual({ kind: "external", url: "https://www.csca.cn/" });
    expect(linkTarget("http://insecure.example")).toBeNull();
    expect(linkTarget("javascript:alert(1)")).toBeNull();
    expect(linkTarget("evo-app://csca")).toBeNull();
    expect(linkTarget("/apply/status")).toBeNull();
  });
});
