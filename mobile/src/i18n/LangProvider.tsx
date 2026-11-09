import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (isLang(stored)) setLangState(stored);
      })
      .catch(() => undefined);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo<LangContextValue>(
    () => ({
      lang,
      setLang,
      m: (key) => mobileString(lang, key),
      format: formatPortalString,
      t: (namespace) => getPortalStrings(namespace, lang),
      shell: getPortalStrings("shell", lang),
      profile: getPortalStrings("profile", lang),
      recovery: getPasswordRecoveryStrings(lang),
      fill: fillRecoveryString,
    }),
    [lang, setLang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const value = useContext(LangContext);
  if (!value) throw new Error("useLang вне LangProvider");
  return value;
}
