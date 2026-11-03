import { staffHomeRoute, staffCanAccessRoute } from "@/lib/platform-access";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  isFixedRoleRoute,
  type FixedRoleRoute,
} from "@/lib/fixed-role-policy";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { chromeWords, roleTitle } from "@/lib/v3/wording";

export const metadata = { title: "Нет доступа" };

const ROUTE_LABELS: Record<FixedRoleRoute, string> = {
  "/main": "Сегодня",
  "/pipeline": "Воронка продаж",
  "/admissions-pipeline": "Воронка поступления",
  "/inbox": "WhatsApp",
  "/requests": "Заявки",
  "/profile": "Студенты",
  "/calendar": "Календарь",
  "/tasks": "Задачи",
  "/team-chat": "Командный чат",
  "/messages": "Переписка",
  "/universities": "Университеты",
  "/knowledge": "База знаний",
  "/marketing": "Маркетинг",
  "/finance": "Финансы",
  "/ui-kit": "Набор виджетов",
  "/ai-agent": "ИИ-агент",
  "/ai-agents": "ИИ-агенты",
  "/documents": "Документы",
  "/reply-snippets": "Шаблоны ответов",
  "/settings": "Настройки",
};

function firstValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const actor = await requirePlatformStaffActor();
  const requestedPath = firstValue((await searchParams).from);

  if (
    isFixedRoleRoute(requestedPath) &&
    staffCanAccessRoute(actor, requestedPath)
  ) {
    redirect(requestedPath);
  }

  const home = staffHomeRoute(actor);
  const requestedLabel = isFixedRoleRoute(requestedPath)
    ? ROUTE_LABELS[requestedPath]
    : "Защищённый раздел";
  // Название роли — как в меню («Администратор»), а не ключ «Admin».
  const accessLabel = actor.presentationRole
    ? roleTitle(actor.presentationRole)
    : actor.systemRole === "admin"
      ? "Администратор"
      : [...new Set(actor.assignments.map((item) => item.label))].join(", ") || "Права ещё не назначены";

  return (
    <main
      className="mx-auto flex min-h-[70dvh] w-full max-w-3xl items-center px-4 py-10 sm:px-6"
      data-testid="access-denied-state"
    >
      <section className="w-full border-y border-border py-10 sm:py-14">
        <h1 className="t-page-title text-fg">
          Нет доступа к разделу
        </h1>
        <p className="mt-3 max-w-2xl t-body-compact text-fg-2">
          Раздел «{requestedLabel}» пока не открыт для вашей учётной записи.
        </p>
        <p className="mt-4 t-body-compact text-fg-2" data-testid="access-denied-access">
          Ваш доступ: <span className="t-item text-fg">{accessLabel}</span>
        </p>
        <Link
          href={home}
          className="mt-8 inline-flex min-h-11 items-center rounded-ctl bg-accent px-4 t-item text-on-accent hover:bg-accent-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {chromeWords.accessDenied.staffAction}
        </Link>
      </section>
    </main>
  );
}
