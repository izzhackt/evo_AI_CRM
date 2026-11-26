import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { hydrateFromStorage } from "@/lib/storage-hydration";
import {
  DEFAULT_LANG,
  fillRecoveryString,
  formatPortalString,
  getPasswordRecoveryStrings,
  getPortalStrings,
  isLang,
  mobileString,
  type Lang,
  type MobileStringKey,
  type PortalNamespace,
  type PortalStrings,
} from "@/i18n";

const STORAGE_KEY = "evo.lang";

type LangContextValue = Readonly<{
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Язык студента с устройства уже применён (или его нет, или чтение сорвалось); см. `ThemeProvider.hydrated`. */
  hydrated: boolean;
  /** Строка приложения. */
  m: (key: MobileStringKey) => string;
  /** Подстановка `{name}` в строку приложения или веба. */
  format: typeof formatPortalString;
  /** Словарь любого пространства имён веба (`home`, `admission`, `timeline`...). */
  t: <N extends PortalNamespace>(namespace: N) => PortalStrings<N>;
  shell: ReturnType<typeof getPortalStrings<"shell">>;
  profile: ReturnType<typeof getPortalStrings<"profile">>;
  recovery: ReturnType<typeof getPasswordRecoveryStrings>;
  fill: typeof fillRecoveryString;
}>;

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children, initial = DEFAULT_LANG }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const [hydrated, setHydrated] = useState(false);
  // Студент уже выбрал язык сам: его выбор новее того, что лежало на устройстве (см. `ThemeProvider`).
  const chosenNow = useRef(false);

  useEffect(
    () =>
      hydrateFromStorage(STORAGE_KEY, (stored) => {
        if (isLang(stored) && !chosenNow.current) setLangState(stored);
        setHydrated(true);
      }),
    [],
  );

  const setLang = useCallback((next: Lang) => {
    chosenNow.current = true;
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo<LangContextValue>(
    () => ({
      lang,
      setLang,
      hydrated,
      m: (key) => mobileString(lang, key),
      format: formatPortalString,
      t: (namespace) => getPortalStrings(namespace, lang),
      shell: getPortalStrings("shell", lang),
      profile: getPortalStrings("profile", lang),
      recovery: getPasswordRecoveryStrings(lang),
      fill: fillRecoveryString,
    }),
    [lang, setLang, hydrated],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const value = useContext(LangContext);
  if (!value) throw new Error("useLang вне LangProvider");
  return value;
}

/** Язык, если провайдер языка есть; без него `null`. Для того, что работает и вне провайдера и берёт язык только для редкого сообщения. */
export function useOptionalLang(): LangContextValue | null {
  return useContext(LangContext);
}
