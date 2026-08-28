import { Card, PageHeader } from "@/components/ui";
import { selectDevelopmentRolePreviewAction } from "@/lib/development-gate-actions";
import { requirePlatformCapability } from "@/lib/platform-guards";

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

export default async function SettingsPage() {
  const actor = await requirePlatformCapability("admin.preview", "/settings");

  return (
    <div className="space-y-5" data-testid="fixed-role-settings">
      <PageHeader
        eyebrow="Private local V2"
        title="Точные интерфейсы фиксированных ролей"
        description="Это не управление сотрудниками. Admin меняет только подписанный effective role своей короткой development-сессии."
      />
      <Card>
        <form action={selectDevelopmentRolePreviewAction} className="grid gap-4 lg:grid-cols-3">
          {(["admin", "sales", "admissions"] as const).map((role) => (
            <button
              key={role}
              type="submit"
              name="role"
              value={role}
              data-testid={`settings-preview-${role}`}
              aria-pressed={actor.platformRole === role}
              className="min-h-36 rounded-card border border-border bg-bg p-5 text-left transition-colors hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent-weak"
            >
              <span className="block text-base font-bold text-fg">
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
