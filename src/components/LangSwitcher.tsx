import { setLocaleAction } from "@/lib/actions";
import { LOCALES, Locale, LOCALE_NAMES } from "@/lib/i18n";

export function LangSwitcher({ current }: { current: Locale }) {
  return (
    <form
      action={setLocaleAction}
      aria-label="Language"
      className="inline-flex rounded-md border border-[var(--evo-border)] bg-white p-0.5 shadow-sm"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="submit"
          name="locale"
          value={l}
          title={LOCALE_NAMES[l]}
          aria-pressed={l === current}
          className={`min-w-9 rounded px-2.5 py-1.5 text-xs font-semibold uppercase transition ${
            l === current ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
