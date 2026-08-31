import type { Metadata } from "next";
import Link from "next/link";

import {
  logoutDevelopmentGateAction,
  selectDevelopmentRolePreviewAction,
} from "@/lib/development-gate-actions";
import { fixedRoleHomeRoute } from "@/lib/fixed-role-policy";
import { requirePlatformActor } from "@/lib/platform-guards";
import { buildRouteMetadata } from "@/lib/route-metadata";
import { readDatabaseStatus } from "@/lib/server/database-status";

const ROLE_LABELS = {
  admin: "Director/Admin",
  sales: "Sales Manager",
  admissions: "Admissions Manager",
} as const;

const COPY = {
  ru: {
    tabTitle: "Вход подтверждён",
  },
  ky: {
    tabTitle: "Кирүү ырасталды",
  },
  en: {
    tabTitle: "Access verified",
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: COPY.ru.tabTitle,
    ky: COPY.ky.tabTitle,
    en: COPY.en.tabTitle,
  });
}

export default async function Home() {
  const [actor, database] = await Promise.all([
    requirePlatformActor(),
    readDatabaseStatus(),
  ]);
  const role = actor.platformRole;
  if (role !== "admin" && role !== "sales" && role !== "admissions") {
    throw new Error("development_gate_issued_unsupported_role");
  }
  const previewing = actor.authorityRole === "admin" && role !== "admin";

  return (
    <main
      data-testid="development-workspace"
      className="min-h-dvh bg-bg px-4 py-8 text-fg sm:px-8"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-border bg-surface px-5 py-4 shadow-evo">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[11px] bg-accent text-lg font-bold text-on-accent">
              E
            </span>
            <span>
              <span className="block text-md font-bold">EVO Admissions CRM</span>
              <span className="block text-xs text-fg-3">Private local V2</span>
            </span>
          </div>
          <form action={logoutDevelopmentGateAction}>
            <button
              type="submit"
              data-testid="development-logout"
              className="min-h-11 rounded-ctl border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-2"
            >
              Выйти
            </button>
          </form>
        </header>

        <section className="rounded-[24px] border border-border bg-surface p-6 shadow-evo-lg sm:p-8">
          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            Вход в EVO V2 подтверждён
          </h1>
          <p className="mt-3 max-w-[60ch] text-sm leading-6 text-fg-3">
            Это техническая роль для локальной проверки CRM, а не аккаунт
            сотрудника и не production-аутентификация.
          </p>

          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            <article className="rounded-[18px] border border-border bg-bg p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-3">
                Активная роль
              </p>
              <p
                data-testid="active-role"
                data-role={role}
                data-authority-role={actor.authorityRole}
                className="mt-2 text-xl font-bold"
              >
                {ROLE_LABELS[role]}
              </p>
            </article>
            <article className="rounded-[18px] border border-border bg-bg p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-3">
                PostgreSQL
              </p>
              <p
                data-testid="database-status"
                data-status={database.ok ? "ready" : "blocked"}
                className="mt-2 text-xl font-bold"
              >
                {database.ok
                  ? `Готов · contract v${database.contractVersion}`
                  : `Заблокировано · ${database.code}`}
              </p>
            </article>
          </div>

          {actor.authorityRole === "admin" ? (
            <section
              data-testid="admin-role-preview"
              className="mt-5 rounded-[18px] border border-border bg-bg p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-3">
                Admin · точный просмотр роли
              </p>
              <p className="mt-2 text-sm leading-6 text-fg-3">
                Интерфейс и серверные проверки используют выбранную роль. Подпись
                сессии сохраняет Admin как единственного владельца переключателя.
              </p>
              <form
                action={selectDevelopmentRolePreviewAction}
                className="mt-4 flex flex-wrap gap-2"
              >
                {(["admin", "sales", "admissions"] as const).map((targetRole) => (
                  <button
                    key={targetRole}
                    type="submit"
                    name="role"
                    value={targetRole}
                    data-testid={`preview-role-${targetRole}`}
                    aria-pressed={role === targetRole}
                    className="min-h-11 rounded-ctl border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-on-accent"
                  >
                    {ROLE_LABELS[targetRole]}
                  </button>
                ))}
              </form>
              {previewing ? (
                <p data-testid="preview-active" className="mt-3 text-sm font-semibold text-accent">
                  Admin сейчас ограничен точными правами {ROLE_LABELS[role]}.
                </p>
              ) : null}
            </section>
          ) : null}

          <Link
            href={fixedRoleHomeRoute(role)}
            data-testid="open-role-workspace"
            className="mt-5 inline-flex min-h-11 items-center rounded-ctl bg-accent px-4 text-base font-semibold text-on-accent"
          >
            Открыть рабочий интерфейс
          </Link>
        </section>
      </div>
    </main>
  );
}
