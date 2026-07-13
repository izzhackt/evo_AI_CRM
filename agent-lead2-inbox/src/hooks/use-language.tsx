"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isLocale,
  translate,
  type Locale,
  type TranslationKey,
  type TranslationParams,
} from "@/lib/i18n";

interface LanguageContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const fromAttr = document.documentElement.dataset.locale;
  if (isLocale(fromAttr)) return fromAttr;
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
  }
  return DEFAULT_LOCALE;
}

function applyLocale(next: Locale) {
  document.documentElement.dataset.locale = next;
  document.documentElement.lang = next;
  document.cookie = `${LOCALE_STORAGE_KEY}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    applyLocale(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Non-fatal: the setting still applies for this tab.
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "ru" ? "en" : "ru");
  }, [locale, setLocale]);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) =>
      translate(locale, key, params),
    [locale],
  );

  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== LOCALE_STORAGE_KEY) return;
      if (isLocale(e.newValue) && e.newValue !== locale) {
        setLocaleState(e.newValue);
        applyLocale(e.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [locale]);

  return (
    <LanguageContext.Provider value={{ locale, setLocale, toggleLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      toggleLocale: () => {},
      t: (key, params) => translate(DEFAULT_LOCALE, key, params),
    };
  }
  return ctx;
}
