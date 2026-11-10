import { createHash } from "node:crypto";

import {
  chatHasUnreadFromTeam,
  decodeChatPage,
  decodePoll,
  decodePostReceipt,
  dropSent,
  markOutbox,
  newestSequenceId,
  notificationReadRequestId,
  pollSectionFor,
  prepareBody,
  shouldMarkRead,
  unreadNotifications,
  uuidV5,
  versionChanged,
  type OutboxItem,
} from "@/domain/inbox-model";
import { PortalDecodeError, normalizeStudentPortalNotification } from "@/domain/portal-source";
import { MSG_A, MSG_B, POST_RECEIPT, chatMessage, chatPage } from "@/test-fixtures/inbox";
import { NOTIFICATION_ROW } from "@/test-fixtures/rpc-rows";

/** Эталон: тот же алгоритм, что в вебе (node:crypto). */
function webUuidV5(name: string): string {
  const ns = Buffer.from("73f89df8-d811-5352-9a97-a87652d591c1".replaceAll("-", ""), "hex");
  const hash = createHash("sha1").update(ns).update(Buffer.from(name, "utf8")).digest().subarray(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe("разбор ответов", () => {
  it("страница чата: строгая форма, убывающие sequenceId", () => {
    const page = decodeChatPage(chatPage([chatMessage(MSG_B, "12", false, "Здравствуйте"), chatMessage(MSG_A, "11", true, "Привет")]));
    expect(page.messages.map((m) => m.sequenceId)).toEqual(["12", "11"]);
    expect(() => decodeChatPage(chatPage([chatMessage(MSG_A, "11", true, "a"), chatMessage(MSG_B, "12", true, "b")]))).toThrow(PortalDecodeError);
    expect(() => decodeChatPage({ ...chatPage([]), extra: 1 })).toThrow(PortalDecodeError);
    expect(() => decodeChatPage(null)).toThrow(PortalDecodeError);
    expect(() => decodeChatPage({ ...chatPage([]), awaitState: "weird" })).toThrow(PortalDecodeError);
  });

  it("квитанция обязана подтвердить этот request id", () => {
    const id = "b0000000-0000-4000-8000-000000000001";
    expect(decodePostReceipt(POST_RECEIPT(id), id).sequenceId).toBe("9");
    expect(() => decodePostReceipt(POST_RECEIPT("b0000000-0000-4000-8000-000000000002"), id)).toThrow(PortalDecodeError);
    expect(() => decodePostReceipt({ requestId: id }, id)).toThrow(PortalDecodeError);
  });

  it("опрос: access, unread, version", () => {
    expect(decodePoll({ access: true, unread: 3, version: "0123456789abcdef0123456789abcdef" })).toEqual({ access: true, unread: 3, version: "0123456789abcdef0123456789abcdef" });
    expect(decodePoll({ access: true, unread: "2", version: null }).unread).toBe(2);
    expect(decodePoll({ access: false })).toEqual({ access: false, unread: 0, version: null });
    expect(() => decodePoll({ access: true, unread: -1, version: null })).toThrow(PortalDecodeError);
    expect(() => decodePoll({ access: true, unread: 1, version: "xyz" })).toThrow(PortalDecodeError);
    expect(() => decodePoll([])).toThrow(PortalDecodeError);
  });
});

describe("текст к отправке и очередь", () => {
  it("обрезка пробелов, 1..2000", () => {
    expect(prepareBody("  привет \n")).toBe("привет");
    expect(prepareBody("   ")).toBeNull();
    expect(prepareBody("x".repeat(2000))).toHaveLength(2000);
    expect(prepareBody("x".repeat(2001))).toBeNull();
  });

  it("очередь: смена статуса и уход после подтверждения", () => {
    const a: OutboxItem = { requestId: "r1", body: "a", status: "sending", createdAt: "2026-09-07T08:00:00Z" };
    const b: OutboxItem = { requestId: "r2", body: "b", status: "sending", createdAt: "2026-09-07T08:01:00Z" };
    const failed = markOutbox([a, b], "r1", "failed");
    expect(failed.map((i) => i.status)).toEqual(["failed", "sending"]);
    expect(dropSent(failed, "r1").map((i) => i.requestId)).toEqual(["r2"]);
  });
});

describe("непрочитанное", () => {
  const read = normalizeStudentPortalNotification({ ...NOTIFICATION_ROW, notification_id: "66666666-6666-4666-8666-666666666667", read_at: "2026-09-07T09:00:00+00:00" });
  const unreadChat = normalizeStudentPortalNotification({ ...NOTIFICATION_ROW, event_code: "case_chat_message", category: "case" });
  const unreadDoc = normalizeStudentPortalNotification(NOTIFICATION_ROW);

  it("счёт и признак сообщения команды", () => {
    expect(unreadNotifications([read, unreadDoc, unreadChat])).toHaveLength(2);
    expect(unreadNotifications(undefined)).toEqual([]);
    expect(chatHasUnreadFromTeam([read, unreadDoc])).toBe(false);
    expect(chatHasUnreadFromTeam([unreadChat])).toBe(true);
  });

  it("«прочитано» только на видимом экране, один раз на сообщение", () => {
    const base = { visible: true, foreground: true, newest: "12", lastSent: null };
    expect(shouldMarkRead(base)).toBe(true);
    expect(shouldMarkRead({ ...base, visible: false })).toBe(false);
    expect(shouldMarkRead({ ...base, foreground: false })).toBe(false);
    expect(shouldMarkRead({ ...base, newest: null })).toBe(false);
    expect(shouldMarkRead({ ...base, lastSent: "12" })).toBe(false);
    expect(shouldMarkRead({ ...base, lastSent: "11" })).toBe(true);
  });

  it("самое новое сообщение", () => {
    expect(newestSequenceId([])).toBeNull();
    const page = decodeChatPage(chatPage([chatMessage(MSG_B, "12", false, "b"), chatMessage(MSG_A, "11", true, "a")]));
    expect(newestSequenceId([...page.messages].reverse())).toBe("12");
  });
});

describe("опрос", () => {
  it("раздел приложения -> раздел опроса", () => {
    expect(pollSectionFor("home")).toBe("admission"); // единственная /portal опрашивается как раздел «admission» (веб)
    expect(pollSectionFor("messages")).toBe("messages");
    expect(pollSectionFor("profile")).toBe("notifications");
    expect(pollSectionFor(null)).toBe("notifications");
  });
  it("смена версии: не первый ответ и обе версии известны", () => {
    expect(versionChanged(undefined, "a")).toBe(false);
    expect(versionChanged(null, "a")).toBe(false);
    expect(versionChanged("a", "a")).toBe(false);
    expect(versionChanged("a", null)).toBe(false);
    expect(versionChanged("a", "b")).toBe(true);
  });
});

describe("UUIDv5 «прочитано»", () => {
  const actor = {
    authUserId: "11111111-1111-4111-8111-111111111111",
    membershipId: "22222222-2222-4222-8222-222222222222",
    organizationId: "33333333-3333-4333-8333-333333333333",
    studentCaseId: "44444444-4444-4444-8444-444444444444",
  };
  const notificationId = "66666666-6666-4666-8666-666666666666";

  it("совпадает с веб-реализацией (node:crypto) и стабилен", () => {
    const expected = webUuidV5(`notification-read:${actor.organizationId}:${actor.studentCaseId}:${actor.membershipId}:${actor.authUserId}:${notificationId}`);
    expect(notificationReadRequestId(actor, notificationId)).toBe(expected);
    expect(notificationReadRequestId(actor, notificationId.toUpperCase())).toBe(expected);
    expect(notificationReadRequestId(actor, "66666666-6666-4666-8666-666666666667")).not.toBe(expected);
  });

  it("SHA-1 на длинных и коротких именах (границы блока)", () => {
    for (const n of [0, 1, 54, 55, 56, 63, 64, 119, 120, 300]) {
      const name = "я".repeat(n);
      expect(uuidV5(name)).toBe(webUuidV5(name));
    }
  });

  it("плохой UUID отвергается", () => {
    expect(() => notificationReadRequestId(actor, "not-a-uuid")).toThrow(TypeError);
  });
});
