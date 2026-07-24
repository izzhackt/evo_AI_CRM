import { setLocaleAction } from "@/lib/actions";
import { LOCALES, type Locale, LOCALE_NAMES } from "@/lib/i18n-data";

export function LangSwitcher({ current }: { current: Locale }) {
  return (
    <form
      action={setLocaleAction}
      aria-label="Language"
      className="inline-flex rounded-ctl bg-surface-2 p-0.5"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="submit"
          name="locale"
          value={l}
          title={LOCALE_NAMES[l]}
          aria-label={LOCALE_NAMES[l]}
          aria-pressed={l === current}
          className={`min-h-9 rounded-[8px] px-2.5 py-1.5 text-[12px] font-semibold uppercase transition-[background-color,color] duration-150 ease-out ${
            l === current
              ? "bg-surface text-fg shadow-evo"
              : "text-fg-3 hover:text-fg-2"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
