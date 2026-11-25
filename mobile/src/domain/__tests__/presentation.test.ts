import { getPortalStrings } from "@web/lib/portal/i18n";

import { ADMISSION_STAGE_PATH, actionTarget, actionTitle, allDayDate, evoActionDueLabel, evoActionStatusLabel, formatPortalDeadline, formatPortalMoney, linkTarget, notificationRoute, notificationTargetLabel, portalNotificationKind, portalNotificationText, stageIndex, stageLabel } from "@/domain/presentation";
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

const NID = "66666666-6666-4666-8666-666666666666";

describe("уведомления и ссылки", () => {
  // Одна ссылка на уведомление (веб portalNotificationTarget): три вида ведут на свои экраны решения с идентификатором.
  it.each([
    [{ category: "document", eventCode: "correction_required" }, "/documents"],
    [{ category: "payment_due", eventCode: "x" }, "/payments"],
    [{ category: "anything", eventCode: "case_chat_message" }, "/messages/chat"],
    [{ category: "case", eventCode: "case_help_answer" }, `/messages/reply/${NID}`],
    [{ category: "application", eventCode: "application_package_review" }, `/messages/package-decision/${NID}`],
    [{ category: "application", eventCode: "application_document_review" }, `/messages/document-decision/${NID}`],
    [{ category: "novelty", eventCode: "new_thing" }, "/home"],
  ])("%j -> %s", (input, route) => expect(notificationRoute({ notificationId: NID, ...input })).toBe(route));

  it("вид события важнее категории: проверка документа программы ведёт на своё решение, а не в «Документы»", () => {
    expect(notificationRoute({ notificationId: NID, category: "document.review", eventCode: "application_document_review" })).toBe(`/messages/document-decision/${NID}`);
    expect(notificationRoute({ notificationId: NID, category: "payment", eventCode: "case_help_answer" })).toBe(`/messages/reply/${NID}`);
  });

  // Подпись ссылки (веб targetReply, targetProgramDocument, targetProgramPackage ...): у каждого вида своя, ссылка есть всегда.
  it.each([
    [{ category: "case", eventCode: "case_help_answer" }, "Прочитать ответ куратора", "Куратордун жообун окуу"],
    [{ category: "application", eventCode: "application_package_review" }, "Открыть решение по документам", "Документтер боюнча чечимди ачуу"],
    [{ category: "application", eventCode: "application_document_review" }, "Открыть решение по документу", "Документ боюнча чечимди ачуу"],
    [{ category: "anything", eventCode: "case_chat_message" }, "Открыть переписку", "Кат алышууну ачуу"],
    [{ category: "document", eventCode: "x" }, "Открыть документы", "Документтерди ачуу"],
    [{ category: "payment_due", eventCode: "x" }, "Открыть оплату", "Төлөмдү ачуу"],
    [{ category: "novelty", eventCode: "x" }, "Открыть поступление", "Тапшырууну ачуу"],
  ])("подпись %j: %s", (input, ruLabel, kyLabel) => {
    expect(notificationTargetLabel({ notificationId: NID, ...input }, ru)).toBe(ruLabel);
    expect(notificationTargetLabel({ notificationId: NID, ...input }, ky)).toBe(kyLabel);
  });

  // Значок строки «Что нового» (веб portalNotificationKind): те же ветки, что у перехода.
  it.each([
    [{ category: "application.package", eventCode: "application_package_review" }, "package"],
    [{ category: "application.document.review", eventCode: "application_document_review" }, "document"],
    [{ category: "case", eventCode: "case_help_answer" }, "message"],
    [{ category: "anything", eventCode: "case_chat_message" }, "message"],
    [{ category: "document", eventCode: "correction_required" }, "document"],
    [{ category: "payment_due", eventCode: "x" }, "payment"],
    [{ category: "novelty", eventCode: "new_thing" }, "other"],
  ])("значок %j -> %s", (input, kind) => expect(portalNotificationKind(input)).toBe(kind));

  it("значок и переход согласованы: оплата ведёт в «Оплату», документ - в «Документы», остальное - на «Главную»", () => {
    expect(notificationRoute({ notificationId: NID, category: "payment_due", eventCode: "x" })).toBe("/payments");
    expect(portalNotificationKind({ category: "payment_due", eventCode: "x" })).toBe("payment");
    expect(notificationRoute({ notificationId: NID, category: "document", eventCode: "x" })).toBe("/documents");
    expect(portalNotificationKind({ category: "document", eventCode: "x" })).toBe("document");
    expect(notificationRoute({ notificationId: NID, category: "novelty", eventCode: "x" })).toBe("/home");
    expect(portalNotificationKind({ category: "novelty", eventCode: "x" })).toBe("other");
  });

  it("сообщение команды подписано на языке студента", () => {
    expect(portalNotificationText({ eventCode: "case_chat_message", subjectLabel: "текст по-русски", detail: "x" }, ky)).toEqual({
      title: ky.caseChatNotificationTitle,
      detail: ky.caseChatNotificationDetail,
    });
    expect(portalNotificationText({ eventCode: "other", subjectLabel: "Паспорт", detail: null }, ru)).toEqual({ title: "Паспорт", detail: null });
  });

  it("решение по чеку: слова решения на языке студента, сумма и причина как хранятся", () => {
    expect(portalNotificationText({ eventCode: "payment_receipt_accepted", subjectLabel: "100.50 USD", detail: null }, ru)).toEqual({ title: "Чек принят: 100.50 USD", detail: null });
    expect(portalNotificationText({ eventCode: "payment_receipt_rejected", subjectLabel: "Не видно сумму", detail: null }, ky).title).toBe(`${ky.receiptNotifRejected.replace("{value}", "Не видно сумму")}`);
    expect(notificationRoute({ notificationId: NID, category: "payment.receipt", eventCode: "payment_receipt_accepted" })).toBe("/payments");
  });

  it("ссылки контента: вкладка, браузер или никуда", () => {
    expect(linkTarget("/portal/csca")).toEqual({ kind: "route", route: "/csca" });
    expect(linkTarget("/portal")).toEqual({ kind: "route", route: "/home" });
    expect(linkTarget("/portal/home")).toEqual({ kind: "route", route: "/home" });
    expect(linkTarget("/portal#path")).toEqual({ kind: "route", route: "/home?path=open" });
    expect(linkTarget("/portal/home#path")).toEqual({ kind: "route", route: "/home?path=open" });
    expect(linkTarget("/portal#list")).toEqual({ kind: "route", route: "/home" });
    expect(linkTarget("/portal?view=programs#list")).toEqual({ kind: "route", route: "/home?list=programs" });
    expect(linkTarget("/portal/messages?view=chat")).toEqual({ kind: "route", route: "/messages/chat" });
    expect(linkTarget("/portal/messages?view=updates")).toEqual({ kind: "route", route: "/messages/updates" });
    expect(linkTarget("https://www.csca.cn/")).toEqual({ kind: "external", url: "https://www.csca.cn/" });
    expect(linkTarget("http://insecure.example")).toBeNull();
    expect(linkTarget("javascript:alert(1)")).toBeNull();
    expect(linkTarget("evo-app://csca")).toBeNull();
    expect(linkTarget("/apply/status")).toBeNull();
  });
});
