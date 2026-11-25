import { useQuery } from "@tanstack/react-query";

import { readChatPage } from "@/api/inbox-api";
import {
  isNotificationId,
  readCaseHelpPage,
  readDocumentNotification,
  readHelpReply,
  readPackageDetail,
  readPackageNotification,
} from "@/api/inbox-detail-api";
import { usePortalApi } from "@/api/PortalApi";

/** Последняя страница чата: один запрос на список «Входящие» и на сам чат. */
export function useChatLatest() {
  const { transport, tier, userKey } = usePortalApi();
  return useQuery({ queryKey: ["portal", userKey, "chat"], queryFn: () => readChatPage(transport, null), enabled: tier === "assisted" });
}

/**
 * Ответ куратора по уведомлению. Ключ начинается с `["portal", userKey]`: опрос оболочки перечитывает открытые экраны
 * при смене версии, а выход из кабинета сбрасывает кэш целиком.
 */
export function useHelpReply(notificationId: string) {
  const { transport, tier, userKey, studentCaseId } = usePortalApi();
  return useQuery({
    queryKey: ["portal", userKey, "help-reply", notificationId],
    queryFn: () => readHelpReply(transport, notificationId, studentCaseId),
    enabled: tier === "assisted" && isNotificationId(notificationId),
  });
}

/** Первая страница прежних обращений к куратору («Прежние вопросы куратору и ответы» под списком «Входящих»). */
export function useCaseHelp() {
  const { transport, tier, userKey, studentCaseId } = usePortalApi();
  return useQuery({
    queryKey: ["portal", userKey, "case-help"],
    queryFn: () => readCaseHelpPage(transport, studentCaseId, null),
    enabled: tier === "assisted",
  });
}

export function useDocumentNotification(notificationId: string) {
  const { transport, tier, userKey, studentCaseId } = usePortalApi();
  return useQuery({
    queryKey: ["portal", userKey, "document-notification", notificationId],
    queryFn: () => readDocumentNotification(transport, notificationId, studentCaseId),
    enabled: tier === "assisted" && isNotificationId(notificationId),
  });
}

export function usePackageNotification(notificationId: string) {
  const { transport, tier, userKey, studentCaseId } = usePortalApi();
  return useQuery({
    queryKey: ["portal", userKey, "package-notification", notificationId],
    queryFn: () => readPackageNotification(transport, notificationId, studentCaseId),
    enabled: tier === "assisted" && isNotificationId(notificationId),
  });
}

/** Состав комплекта читается после решения: адрес программы и номер комплекта приходят в уведомлении. */
export function usePackageDetail(target: { applicationId: string; packageId: string } | null) {
  const { transport, tier, userKey, studentCaseId } = usePortalApi();
  return useQuery({
    queryKey: ["portal", userKey, "package-detail", target?.applicationId ?? "", target?.packageId ?? ""],
    queryFn: () => readPackageDetail(transport, { studentCaseId, applicationId: target!.applicationId }, target!.packageId),
    enabled: tier === "assisted" && target !== null,
  });
}
