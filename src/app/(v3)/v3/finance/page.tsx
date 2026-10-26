import { EmptyState } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";
import { requireV3PageActor } from "@/lib/platform-guards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Финансы" };

/**
 * «Финансы» (решение владельца 26.10.2026): раздел верхнего уровня рядом с «Маркетингом». Пока заготовка под
 * доходы, расходы и расчёты — бухгалтерию подключат позже, поэтому на странице нет ни цифр, ни кнопок.
 * Доступ тот же, что у «Маркетинга»: только настоящий администратор, не просмотр роли; остальных
 * `requireV3PageActor` отправляет на «Нет доступа».
 */
export default async function FinancePage() {
  await requireV3PageActor("/v3/finance");
  return (
    <PartShell title="Финансы" testId="v3-finance">
      <div className="rounded-card border border-border bg-surface">
        <EmptyState text="Здесь будут доходы, расходы и расчёты EVO." />
      </div>
    </PartShell>
  );
}
