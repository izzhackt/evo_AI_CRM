import {
  LOCALES,
  LOCALE_NAMES,
  type Locale,
} from "@/lib/i18n-data";
import { setLocaleAction } from "@/lib/locale-actions";

export function PlatformLangSwitcher({ current }: { current: Locale }) {
  return (
    <form
      action={setLocaleAction}
      aria-label="Language"
      className="inline-flex rounded-ctl bg-surface-2 p-0.5"
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="submit"
          name="locale"
          value={locale}
          title={LOCALE_NAMES[locale]}
          aria-label={LOCALE_NAMES[locale]}
          aria-pressed={locale === current}
          className={`min-h-9 rounded-[8px] px-2.5 py-1.5 text-xs font-semibold uppercase transition-[background-color,color] duration-150 ease-out ${
            locale === current
              ? "border border-control-edge bg-surface text-fg"
              : "text-fg-3 hover:text-fg-2"
          }`}
        >
          {locale.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
