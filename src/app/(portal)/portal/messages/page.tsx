import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MessagesThread } from "@/components/portal/messages/MessagesThread";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { readPortalCaseMessages } from "@/lib/portal/messages-source";
import type { PortalCaseMessagesPage } from "@/lib/portal/messages";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("messages", await getLocale());
  return { title: `${strings.title} — EVO Admissions` };
}

/**
 * Экран «Сообщения» (PORT-5c, план §6 «Общение»; дизайн-контракт §7 «Моё
 * поступление»): переписка с командой EVO по своему делу — только уровень
 * сопровождения. Approved-кейс раздела не видит (Shell), а прямой переход
 * честно возвращает на «Поступление» (замок-дразнилки нет — правило
 * дизайн-контракта); сама граница — в RPC миграции 200 (гейт 192).
 * Разовый вопрос-ответ куратору остаётся блоком на «Поступлении» —
 * страница помечает разницу предметно.
 */
export default async function StudentPortalMessagesPage() {
  const [actor, locale] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
  ]);
  if (actor.caseState === "pending") redirect("/portal");
  const strings = getPortalStrings("messages", locale);

  let initialPage: PortalCaseMessagesPage | null = null;
  try {
    initialPage = await readPortalCaseMessages();
  } catch {
    initialPage = null;
  }

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kicker}</p>
        <h1 className="pt-page-title">{strings.title}</h1>
        <p className="pt-page-lead">{strings.lead}</p>
      </header>
      <p className="pt-chat-difference">
        {strings.differenceNote}{" "}
        <Link href="/portal#case-help" className="pt-link">{strings.differenceLink}</Link>
      </p>
      {initialPage === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : (
        <MessagesThread initialPage={initialPage} strings={strings} locale={locale} />
      )}
    </main>
  );
}
