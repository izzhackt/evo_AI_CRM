import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { NotificationsView } from "@/components/portal/admission/NotificationsView";
import { portalNotificationText } from "@/components/portal/admission/presentation";
import { InboxList, type InboxView } from "@/components/portal/messages/InboxList";
import { MessagesThread } from "@/components/portal/messages/MessagesThread";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { readPortalCaseMessages } from "@/lib/portal/messages-source";
import type { PortalCaseMessagesPage } from "@/lib/portal/messages";
import { markStudentPortalNotificationReadAction } from "@/lib/student-portal-actions";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { readStudentPortalNotifications, type StudentPortalNotification } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("messages", await getLocale());
  return { title: `${strings.title} — EVO Admissions` };
}

/**
 * Та же петля, что на странице «Уведомления»: единственное существующее
 * действие прочтения по каждому непрочитанному id, без нового RPC.
 */
async function markAllInboxUpdatesReadAction(): Promise<void> {
  "use server";
  const notifications = await readStudentPortalNotifications();
  for (const notification of notifications) {
    if (notification.readAt !== null) continue;
    const form = new FormData();
    form.set("notification_id", notification.notificationId);
    await markStudentPortalNotificationReadAction(form);
  }
}

/**
 * «Входящие» (03.11.2026, по образцу кабинета, присланного пользователем):
 * слева лента «Что нового» (уведомления) и переписка с командой EVO, справа —
 * открытое. Это прежний экран «Сообщения» (PORT-5c) — переписка только у
 * уровня сопровождения: approved-кейс раздела не видит (Shell), прямой переход
 * возвращает на «Поступление»; граница — в RPC миграции 200 (гейт 192).
 * Уведомления читаются тем же чтением, что и страница «Уведомления». Разовый
 * вопрос-ответ куратору остаётся блоком на «Поступлении» — строка под списком
 * слева помечает разницу предметно.
 */
export default async function StudentPortalMessagesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ view?: string }> }>) {
  const [actor, locale, search] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
    searchParams,
  ]);
  if (actor.caseState === "pending") redirect("/portal");
  const strings = getPortalStrings("messages", locale);
  const admission = getPortalStrings("admission", locale);
  const view: InboxView = search.view === "updates" ? "updates" : "chat";

  const [initialPage, notifications] = await Promise.all([
    readPortalCaseMessages().catch((): PortalCaseMessagesPage | null => null),
    readStudentPortalNotifications().catch((): readonly StudentPortalNotification[] | null => null),
  ]);

  // RPC отдаёт новые первыми: подписи слева — по первому элементу.
  const latestMessage = initialPage?.messages[0] ?? null;
  const latestUpdate = notifications?.[0] ?? null;
  const chatTime = latestMessage
    ? new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Bishkek",
    }).format(new Date(latestMessage.createdAt))
    : null;

  return (
    <main className="pt-page pt-inbox-page">
      <header className="pt-page-header">
        <h1 className="pt-page-title">{strings.title}</h1>
      </header>
      <div className="pt-inbox">
        <div className="pt-inbox-side">
          <InboxList
            view={view}
            updatesPreview={latestUpdate ? portalNotificationText(latestUpdate, admission).title : null}
            unreadCount={notifications?.filter((notification) => notification.readAt === null).length ?? 0}
            chatPreview={latestMessage ? latestMessage.body || latestMessage.attachmentLabel : null}
            chatTime={chatTime}
            locale={locale}
          />
          <p className="pt-inbox-side-foot">
            {strings.differenceNote}{" "}
            <Link href="/portal#case-help" className="pt-link">{strings.differenceLink}</Link>
          </p>
        </div>
        <section className="pt-inbox-pane" aria-labelledby="inbox-pane-title">
          <header className="pt-inbox-pane-head">
            <span className={view === "chat" ? "pt-inbox-avatar pt-inbox-avatar-team" : "pt-inbox-avatar"} aria-hidden="true">
              {view === "chat" ? "EVO" : (
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M10 3a4.5 4.5 0 0 1 4.5 4.5c0 3.2 1 4.5 1.5 5H4c.5-.5 1.5-1.8 1.5-5A4.5 4.5 0 0 1 10 3zM8.5 15.5a1.5 1.5 0 0 0 3 0"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <div>
              <h2 id="inbox-pane-title" className="pt-inbox-pane-title">
                {view === "chat" ? strings.chatTitle : strings.updatesTitle}
              </h2>
              <p className="pt-inbox-pane-sub">{view === "chat" ? strings.chatSubline : strings.updatesSubline}</p>
            </div>
          </header>
          {/* Переписка прокручивает свою ленту сама; «Что нового» — вся колонка. */}
          <div
            className={view === "chat" ? "pt-inbox-pane-body pt-inbox-pane-body-chat" : "pt-inbox-pane-body"}
            {...(view === "chat" ? {} : { role: "region", "aria-labelledby": "inbox-pane-title", tabIndex: 0 })}
          >
            {view === "chat" ? (
              initialPage === null ? (
                <p role="alert" className="pt-alert">{strings.unavailable}</p>
              ) : (
                <MessagesThread initialPage={initialPage} strings={strings} locale={locale} draftScope={`${actor.membershipId}:${actor.studentCaseId}`} />
              )
            ) : notifications === null ? (
              <p role="alert" className="pt-alert">{strings.updatesUnavailable}</p>
            ) : (
              <NotificationsView
                notifications={notifications}
                markReadAction={markStudentPortalNotificationReadAction}
                markAllReadAction={markAllInboxUpdatesReadAction}
                locale={locale}
                embedded
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
