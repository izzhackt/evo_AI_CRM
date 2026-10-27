import { KeyFacts } from "@/components/kit";
import { CHECKLIST, COUNT_WORDS, LOGIN_WORDS, REASON_WORDS } from "@/components/v3/settings/AccountDeletionSection";
import type { AccountDeletionDetail } from "@/lib/account-deletion-contract";

/** Автоматическое удаление простого аккаунта: что удалится (счётчики по группам) и что остаётся. Записи других людей не меняются. */
export function AutomaticPlan({ d }: Readonly<{ d: AccountDeletionDetail }>) {
  const items = Object.entries(COUNT_WORDS).filter(([key]) => d.counts[key as keyof typeof COUNT_WORDS] > 0);
  return (
    <div className="grid gap-4" data-testid="v3-deletion-automatic">
      <section data-testid="v3-deletion-delete" className="grid gap-2">
        <h3 className="t-item text-fg">{d.status === "completed" ? "Удалено автоматически" : "Удалится автоматически"}</h3>
        <KeyFacts columns={1} facts={[
          { label: "Аккаунт", value: "Вход, email и пароль, журнал входов" },
          ...items.map(([key, label]) => ({ label, value: <span className="tabular-nums">{d.counts[key as keyof typeof COUNT_WORDS]}</span> })),
        ]} />
      </section>
      <section data-testid="v3-deletion-remain" className="grid gap-1">
        <h3 className="t-item text-fg">Не меняется</h3>
        <p className="t-body-compact text-fg-2">
          Записи других людей и всё, что не связано с аккаунтом в базе. У этого аккаунта нет дела, лида, клиента, оплат, договора и
          переписки WhatsApp, поэтому удаление автоматическое. Резервные копии базы этим действием не меняются.
        </p>
      </section>
    </div>
  );
}

/** Ручная обработка: почему нельзя автоматически, что делает команда по списку (кому поручено каждое действие) и состояние входа. */
export function ManualPlan({ d }: Readonly<{ d: AccountDeletionDetail }>) {
  const reasons = d.reasons.map((reason) => REASON_WORDS[reason]);
  return (
    <section className="grid gap-3" data-testid="v3-deletion-manual" aria-labelledby="v3-deletion-manual-title">
      <h3 id="v3-deletion-manual-title" className="t-item text-fg">Ручная обработка</h3>
      {reasons.length > 0 ? <p className="t-body-compact text-fg-2" data-testid="v3-deletion-reasons">Автоматически удалить нельзя: {reasons.join("; ")}.</p> : null}
      {d.otherTables.length > 0 ? (
        <details data-testid="v3-deletion-other-tables">
          <summary className="t-label inline-flex min-h-11 cursor-pointer items-center text-fg-2 underline underline-offset-4 hover:text-fg">Для технического администратора</summary>
          <p className="t-meta break-all text-fg-2">Другие записи в таблицах: {d.otherTables.join(", ")}.</p>
        </details>
      ) : null}
      <p className="t-body-compact text-fg">
        Удалить или обезличить по списку в течение 30 дней с даты запроса. Многие пункты делает технический администратор с доступом к базе:
        в CRM для них кнопок нет.
      </p>
      <ol className="grid" data-testid="v3-deletion-checklist">
        {CHECKLIST.map((item, index) => (
          <li key={item.what} className="t-body-compact flex gap-2 border-b border-border py-1.5 last:border-b-0">
            <span className="tabular-nums text-fg-2">{index + 1}.</span>
            <span className="min-w-0"><span className="text-fg">{item.what}</span><span className="t-meta block text-fg-2">{item.who}</span></span>
          </li>
        ))}
      </ol>
      <p className="t-body-compact text-fg" data-testid="v3-deletion-login" data-login={d.login}>{LOGIN_WORDS[d.login]}</p>
    </section>
  );
}
