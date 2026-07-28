import { Icon } from "@/components/icons";
import { btnCls, cn, inputCls, labelCls } from "@/components/ui";
import { addLeadAction } from "@/lib/actions";
import type { SalesCopy } from "./SalesCopy";

type StaffOption = {
  id: number;
  name: string;
};

export function SalesQuickAdd({
  staff,
  t,
  copy,
  canAssignManager,
}: {
  staff: StaffOption[];
  t: (key: string) => string;
  copy: SalesCopy;
  canAssignManager: boolean;
}) {
  return (
    <section
      id="add"
      aria-labelledby="sales-add-title"
      className="scroll-mt-24 rounded-card border border-border bg-surface p-4 shadow-evo sm:p-5"
    >
      <header className="mb-4 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-accent-weak text-accent">
          <Icon name="plus" size={17} />
        </span>
        <div>
          <h2 id="sales-add-title" className="text-[14px] font-semibold text-fg">
            {t("quickAddLead")}
          </h2>
          <p id="sales-add-hint" className="mt-0.5 text-[12px] leading-5 text-fg-3">
            {copy.quickAddHint}
          </p>
        </div>
      </header>

      <form
        action={addLeadAction}
        aria-describedby="sales-add-hint"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <label>
          <span className={labelCls}>{t("leadName")}</span>
          <input
            name="name"
            required
            autoComplete="name"
            placeholder={t("leadName")}
            className={inputCls}
          />
        </label>
        <label>
          <span className={labelCls}>{t("phone")}</span>
          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder={t("phone")}
            className={inputCls}
          />
        </label>
        <label>
          <span className={labelCls}>{t("email")}</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder={t("email")}
            className={inputCls}
          />
        </label>
        <label>
          <span className={labelCls}>{t("source")}</span>
          <input
            name="source"
            placeholder={t("source")}
            className={inputCls}
          />
        </label>
        <label>
          <span className={labelCls}>{t("country")}</span>
          <input
            name="target_country"
            placeholder={t("country")}
            className={inputCls}
          />
        </label>
        <label>
          <span className={labelCls}>{t("leadAmount")}</span>
          <input
            name="amount"
            type="number"
            min="0"
            inputMode="numeric"
            placeholder={t("leadAmount")}
            className={inputCls}
          />
        </label>
        {canAssignManager && (
          <label>
            <span className={labelCls}>{t("manager")}</span>
            <select name="manager_id" defaultValue="" className={inputCls}>
              <option value="">{t("notAssigned")}</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          className={cn(btnCls, "mt-auto w-full")}
        >
          <Icon name="plus" size={16} />
          {t("add")}
        </button>
      </form>
    </section>
  );
}
