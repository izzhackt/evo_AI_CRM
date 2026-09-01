import type { Metadata } from "next";

import { Card, PageHeader } from "@/components/ui";
import { selectStaffRolePreviewAction } from "@/lib/staff-auth-actions";
import { requirePlatformCapability } from "@/lib/platform-guards";
import { buildRouteMetadata } from "@/lib/route-metadata";

const ROLE_COPY = {
  admin: {
    title: "Director/Admin",
    description: "Полный функциональный союз Sales и Admissions.",
  },
  sales: {
    title: "Sales Manager",
    description: "Sales pipeline, квалификация, ownership и next action до handoff.",
  },
  admissions: {
    title: "Admissions Manager",
    description: "Переданные Student 360, документы, applications и visa.",
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: "Настройки",
    ky: "Жөндөөлөр",
    en: "Settings",
  });
}

export default async function SettingsPage() {
  const actor = await requirePlatformCapability("admin.preview", "/settings");

  return (
    <div className="space-y-5" data-testid="fixed-role-settings">
      <PageHeader
        title="Точные интерфейсы фиксированных ролей"
        description="Это не изменение аккаунта сотрудника. Admin выбирает только точное представление интерфейса, а его Supabase-роль остаётся неизменной."
      />
      <Card>
        <form action={selectStaffRolePreviewAction} className="grid gap-4 lg:grid-cols-3">
          {(["admin", "sales", "admissions"] as const).map((role) => (
            <button
              key={role}
              type="submit"
              name="role"
              value={role}
              data-testid={`settings-preview-${role}`}
              aria-pressed={actor.platformRole === role}
              className="min-h-36 rounded-card border border-control-edge bg-bg p-5 text-left transition-colors hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent-weak"
            >
              <span className="block text-md font-bold text-fg">
                {ROLE_COPY[role].title}
              </span>
              <span className="mt-2 block text-sm leading-6 text-fg-3">
                {ROLE_COPY[role].description}
              </span>
            </button>
          ))}
        </form>
      </Card>
    </div>
  );
}
