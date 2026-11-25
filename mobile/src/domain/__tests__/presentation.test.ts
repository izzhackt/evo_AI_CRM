import { getPortalStrings } from "@web/lib/portal/i18n";

import { ADMISSION_STAGE_PATH, DOCUMENT_FOCUS_PARAM, actionHref, actionTarget, actionTitle, allDayDate, evoActionDueLabel, evoActionStatusLabel, formatPortalDeadline, formatPortalMoney, linkTarget, notificationRoute, portalNotificationKind, portalNotificationText, stageIndex, stageLabel } from "@/domain/presentation";
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
  it("адрес действия: документ открывает «Документы» на своей строке (`focus` = слот), оплата - «Оплату»", () => {
    const action = overview.studentAction!;
    expect(DOCUMENT_FOCUS_PARAM).toBe("focus");
    expect(actionHref(action)).toBe(`/documents?focus=${SLOT_ID}`);
    expect(actionHref({ ...action, documentSlotId: "слот/с пробелом?" } as typeof action)).toBe("/documents?focus=%D1%81%D0%BB%D0%BE%D1%82%2F%D1%81%20%D0%BF%D1%80%D0%BE%D0%B1%D0%B5%D0%BB%D0%BE%D0%BC%3F");
    expect(actionHref({ kind: "payment", label: "x", dueAt: null, amountMinor: 1, currency: "USD" })).toBe("/payments");
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
    [{ category: "novelty", eventCode: "new_thing" }, "/home"],
  ])("%j -> %s", (input, route) => expect(notificationRoute(input)).toBe(route));

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
    expect(notificationRoute({ category: "payment_due", eventCode: "x" })).toBe("/payments");
    expect(portalNotificationKind({ category: "payment_due", eventCode: "x" })).toBe("payment");
    expect(notificationRoute({ category: "document", eventCode: "x" })).toBe("/documents");
    expect(portalNotificationKind({ category: "document", eventCode: "x" })).toBe("document");
    expect(notificationRoute({ category: "novelty", eventCode: "x" })).toBe("/home");
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
    expect(notificationRoute({ category: "payment.receipt", eventCode: "payment_receipt_accepted" })).toBe("/payments");
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

  it("страницы с идентификатором сохраняют его: программа и вуз (общее правило отбросило бы всё после раздела)", () => {
    const id = "bbbbbbbb-0000-4000-8000-000000000001";
    expect(linkTarget(`/portal/preparations/${id}`)).toEqual({ kind: "route", route: `/preparations/${id}` });
    expect(linkTarget(`/portal/preparations/${id}/`)).toEqual({ kind: "route", route: `/preparations/${id}` });
    expect(linkTarget("/portal/preparations/a%20b")).toEqual({ kind: "route", route: "/preparations/a%20b" });
    // негодный идентификатор не уводит на чужой маршрут и не бросает исключения: «Мои программы»
    expect(linkTarget("/portal/preparations/%E0%A4%A")).toEqual({ kind: "route", route: "/home?list=programs" });
    expect(linkTarget("/portal/preparations/..")).toEqual({ kind: "route", route: "/home?list=programs" });
    expect(linkTarget("/portal/preparations/.")).toEqual({ kind: "route", route: "/home?list=programs" });
    const university = "aaaaaaaa-0000-4000-8000-000000000001";
    // веб добавляет к адресу программы хвост: якорь требования или запрос; экран программы в приложении якорей не знает - хвост отбрасывается
    expect(linkTarget(`/portal/preparations/${id}#requirement-passport`)).toEqual({ kind: "route", route: `/preparations/${id}` });
    expect(linkTarget(`/portal/preparations/${id}?tab=requirements`)).toEqual({ kind: "route", route: `/preparations/${id}` });
    expect(linkTarget(`/portal/preparations/${id}?tab=requirements#requirement-passport`)).toEqual({ kind: "route", route: `/preparations/${id}` });
    expect(linkTarget(`/portal/preparations/${id}/#requirement-passport`)).toEqual({ kind: "route", route: `/preparations/${id}` });
    expect(linkTarget("/portal/preparations/a%20b#requirement-x")).toEqual({ kind: "route", route: "/preparations/a%20b" });
    // без годного идентификатора - «Мои программы», с хвостом или без: пустой, лишний сегмент, только хвост
    for (const malformed of ["/portal/preparations", "/portal/preparations/", "/portal/preparations/a/b", `/portal/preparations/${id}/extra`, "/portal/preparations/#requirement-x", "/portal/preparations?x=1", "/portal/preparations#requirement-x", "/portal/preparations//", "/portal/preparations/..#requirement-x"]) {
      expect(linkTarget(malformed)).toEqual({ kind: "route", route: "/home?list=programs" });
    }
    // соседние имена разделов правило программы не задевает
    expect(linkTarget("/portal/preparationsx/a")).toEqual({ kind: "route", route: "/preparationsx" });
    expect(linkTarget(`/portal/universities/${university}`)).toEqual({ kind: "route", route: `/universities/${university}` });
    expect(linkTarget(`/portal/universities/${university.toUpperCase()}`)).toEqual({ kind: "route", route: `/universities/${university}` });
    // не uuid - прежнее правило раздела
    expect(linkTarget("/portal/universities/country/cn")).toEqual({ kind: "route", route: "/universities" });
  });
});
