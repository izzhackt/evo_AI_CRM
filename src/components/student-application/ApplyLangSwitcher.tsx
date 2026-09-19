import { setLocaleAction } from "@/lib/locale-actions";
import { LOCALE_NAMES, type Locale } from "@/lib/i18n-data";

/**
 * Видимый переключатель языка анкеты (PORT-8c). Механизм тот же, что у
 * портала и /login: единственный locale Server Action пишет cookie `locale`.
 * Предлагаются только RU/KY — у портала осознанно нет английского
 * интерфейса, en-cookie резолвится в RU (src/lib/portal/i18n.ts).
 */
const APPLY_LOCALES = ["ru", "ky"] as const;

export function ApplyLangSwitcher({ current, label }: { current: Locale; label: string }) {
  return (
    <form
      action={setLocaleAction}
      aria-label={label}
      className="inline-flex rounded-ctl bg-surface-2 p-0.5"
    >
      {APPLY_LOCALES.map((l) => (
        <button
          key={l}
          type="submit"
          name="locale"
          value={l}
          title={LOCALE_NAMES[l]}
          aria-label={LOCALE_NAMES[l]}
          aria-pressed={l === current}
          className={`min-h-9 rounded-[8px] px-2.5 py-1.5 text-xs font-semibold uppercase transition-[background-color,color] duration-150 ease-out ${
            l === current
              ? "border border-control-edge bg-surface text-fg"
              : "border border-transparent text-fg-3 hover:text-fg-2"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
