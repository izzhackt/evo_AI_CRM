import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon } from "@/components/icons";
import { Card, PageHeader, btnCls } from "@/components/ui";
import { currentUser, isStaff } from "@/lib/auth";
import { ROLE_HOME_ROUTE, STAFF_NAV_ITEMS, roleCanAccessStaffRoute } from "@/lib/domain";
import {
  fixedRoleCanAccessRoute,
  isFixedRoleRoute,
} from "@/lib/fixed-role-policy";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { buildRouteMetadata } from "@/lib/route-metadata";

type Copy = {
  title: string;
  description: string;
  requested: string;
  role: string;
  nextTitle: string;
  nextDescription: string;
  back: string;
  security: string;
  unknown: string;
  knowledge: string;
  transcription: string;
  tabTitle: string;
};

const COPY: Record<Locale, Copy> = {
  ru: {
    title: "Нет доступа к разделу",
    description:
      "Этот раздел не входит в права вашей роли. Защищённые данные раздела не загружались.",
    requested: "Запрошенный раздел",
    role: "Ваша роль",
    nextTitle: "Что делать дальше",
    nextDescription:
      "Вернитесь в свой рабочий раздел. Если доступ нужен по работе, попросите администратора изменить вашу роль или набор прав.",
    back: "Вернуться в мой раздел",
    security: "Доступ проверен на сервере",
    unknown: "Защищённый раздел",
    knowledge: "База знаний",
    transcription: "Лаборатория транскрибации",
    tabTitle: "Нет доступа",
  },
  ky: {
    title: "Бул бөлүмгө кирүүгө укук жок",
    description:
      "Бул бөлүм сиздин ролуңузга берилген эмес. Бөлүмдүн корголгон маалыматтары жүктөлгөн жок.",
    requested: "Суралган бөлүм",
    role: "Сиздин ролуңуз",
    nextTitle: "Андан ары эмне кылуу керек",
    nextDescription:
      "Өз иш бөлүмүңүзгө кайтыңыз. Эгер бул мүмкүнчүлүк жумуш үчүн керек болсо, администратордон ролуңузду же укуктарыңызды өзгөртүүнү сураңыз.",
    back: "Менин бөлүмүмө кайтуу",
    security: "Кирүү укугу серверде текшерилди",
    unknown: "Корголгон бөлүм",
    knowledge: "Билим базасы",
    transcription: "Транскрипция лабораториясы",
    tabTitle: "Кирүүгө укук жок",
  },
  en: {
    title: "You do not have access to this section",
    description:
      "This section is outside the permissions assigned to your role. Its protected data was not loaded.",
    requested: "Requested section",
    role: "Your role",
    nextTitle: "What to do next",
    nextDescription:
      "Return to your workspace. If this access is required for your job, ask an administrator to update your role or permissions.",
    back: "Return to my workspace",
    security: "Access was checked on the server",
    unknown: "Protected section",
    knowledge: "Knowledge base",
    transcription: "Transcription lab",
    tabTitle: "Access denied",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  // Short noun phrase, matching every other route title and the shell's own
  // label for this state. The h1 stays the full sentence.
  return buildRouteMetadata({
    ru: COPY.ru.tabTitle,
    ky: COPY.ky.tabTitle,
    en: COPY.en.tabTitle,
  });
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/portal");

  const { t, locale } = await getT();
  const copy = COPY[locale];
  const requestedPath = firstValue((await searchParams).from);
  const requestedItem = STAFF_NAV_ITEMS.find((item) => item.href === requestedPath);
  const requestedKnowledge = requestedPath === "/v3/knowledge";
  const requestedFixedRoleRoute = isFixedRoleRoute(requestedPath)
    ? requestedPath
    : null;
  if (
    requestedFixedRoleRoute &&
    fixedRoleCanAccessRoute(user.role, requestedFixedRoleRoute)
  ) {
    redirect(requestedFixedRoleRoute);
  }
  if (requestedItem && roleCanAccessStaffRoute(user.role, requestedItem.href)) {
    redirect(requestedItem.href);
  }
  if (requestedPath === "/transcription-lab" && user.role === "admin") {
    redirect("/transcription-lab");
  }
  if (
    !requestedItem &&
    !requestedFixedRoleRoute &&
    requestedPath !== "/transcription-lab"
  ) {
    redirect(ROLE_HOME_ROUTE[user.role]);
  }
  const requestedLabel =
    requestedItem
      ? t(requestedItem.labelKey)
      : requestedKnowledge
        ? copy.knowledge
        : requestedPath === "/transcription-lab"
          ? copy.transcription
          : copy.unknown;
  const home = ROLE_HOME_ROUTE[user.role];

  return (
    <div className="space-y-5">
      <PageHeader
        title={copy.title}
        description={copy.description}
      />

      <Card>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.44fr)]">
          <div className="rounded-card border border-danger/20 bg-danger-weak p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span
                aria-hidden="true"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-danger shadow-evo"
              >
                <Icon name="alert" size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-danger">
                  {copy.security}
                </p>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-fg-3">{copy.requested}</dt>
                    <dd className="mt-1 text-md font-semibold text-fg">{requestedLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-fg-3">{copy.role}</dt>
                    <dd className="mt-1 text-md font-semibold text-fg">{t(`role.${user.role}`)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-5 rounded-card border border-border bg-surface-2 p-5 sm:p-6">
            <div>
              <h2 className="text-md font-semibold text-fg">{copy.nextTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-fg-3">{copy.nextDescription}</p>
            </div>
            <Link href={home} className={btnCls}>
              <Icon name="arrow-left" size={17} />
              {copy.back}
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
