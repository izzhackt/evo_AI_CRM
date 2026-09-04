import Link from "next/link";
import { redirect } from "next/navigation";

import {
  fixedRoleCanAccessRoute,
  fixedRoleHomeRoute,
  isFixedRoleRoute,
  type FixedRoleRoute,
} from "@/lib/fixed-role-policy";
import { requirePlatformStaffActor } from "@/lib/platform-guards";

export const metadata = { title: "Нет доступа · EVO" };

const ROUTE_LABELS: Record<FixedRoleRoute, string> = {
  "/v3/main": "Главная",
  "/v3/pipeline": "Воронка продаж",
  "/v3/inbox": "Входящие",
  "/v3/profile": "Student 360",
  "/v3/calendar": "Календарь",
  "/v3/knowledge": "База знаний",
  "/v3/settings": "Настройки",
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
    fixedRoleCanAccessRoute(actor.presentationRole, requestedPath)
  ) {
    redirect(requestedPath);
  }

  const home = fixedRoleHomeRoute(actor.presentationRole);
  const requestedLabel = isFixedRoleRoute(requestedPath)
    ? ROUTE_LABELS[requestedPath]
    : "Защищённый раздел";

  return (
    <main
      className="mx-auto flex min-h-[70dvh] w-full max-w-3xl items-center px-4 py-10 sm:px-6"
      data-testid="access-denied-state"
    >
      <section className="w-full border-y border-border py-10 sm:py-14">
        <p className="font-mono text-xs font-medium uppercase tracking-wide text-danger">
          Доступ проверен на сервере
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-fg">
          Нет доступа к разделу
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-fg-3">
          Раздел «{requestedLabel}» не входит в интерфейс выбранной роли.
          Защищённые данные раздела не загружались.
        </p>
        <dl className="mt-8 grid gap-5 border-y border-border py-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-fg-3">Запрошенный раздел</dt>
            <dd className="mt-1 font-medium text-fg">{requestedLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-3">Выбранная роль</dt>
            <dd className="mt-1 font-medium uppercase text-fg">
              {actor.presentationRole}
            </dd>
          </div>
        </dl>
        <Link
          href={home}
          className="mt-8 inline-flex min-h-11 items-center rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent"
        >
          Вернуться в мой раздел
        </Link>
      </section>
    </main>
  );
}
