import { setLocaleAction } from "@/lib/actions";
import { LOCALES, type Locale } from "@/lib/i18n-data";

import styles from "./portal.module.css";

export function PortalLanguageSwitcher({
  current,
  label,
}: {
  current: Locale;
  label: string;
}) {
  return (
    <form action={setLocaleAction} aria-label={label} className={styles.languageForm}>
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="submit"
          name="locale"
          value={locale}
          aria-pressed={locale === current}
          className={`${styles.languageButton} ${
            locale === current ? styles.languageButtonActive : ""
          }`}
        >
          {locale}
        </button>
      ))}
    </form>
  );
}
