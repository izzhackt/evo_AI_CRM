import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { hydrateFromStorage } from "@/lib/storage-hydration";
import { darkTokens, lightTokens, menuTokens } from "@/theme/tokens.generated";

export type ThemeChoice = "light" | "dark" | "system";
export type Scheme = "light" | "dark";

export type Tokens = { [K in keyof typeof lightTokens]: (typeof lightTokens)[K] extends number ? number : string };

const STORAGE_KEY = "evo.theme";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

/** Какая схема действует при выборе студента и схеме системы. */
export function resolveScheme(choice: ThemeChoice, system: Scheme | null | undefined): Scheme {
  if (choice === "system") return system === "dark" ? "dark" : "light";
  return choice;
}

export const tokensFor = (scheme: Scheme): Tokens => (scheme === "dark" ? darkTokens : lightTokens) as Tokens;
/** Тёмная колонка меню ☰ одинакова в обеих темах (portal.css, `.pt-nav-menu`). */
export type MenuTokens = Tokens & { railGroup: string };
export const menuTokensFor = (scheme: Scheme): MenuTokens => ({ ...tokensFor(scheme), ...menuTokens }) as MenuTokens;

type ThemeContextValue = Readonly<{
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
  scheme: Scheme;
  tokens: Tokens;
  /**
   * Выбор студента с устройства уже применён (или его нет, или чтение сорвалось). До этого первая отрисовка идёт с темой по
   * умолчанию; экраны, которые могут появиться первыми (сбой, «не настроено»), ждут этого флага (рецензия #1568).
   */
  hydrated: boolean;
}>;

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Тема по умолчанию светлая, как на вебе (решение владельца 02.10 и 25.11.2026): тема ОС не читается, пока студент сам не выбрал
 * «Как в системе» в «Профиле». Выбор студента (кнопка «солнце/луна» вверху или три варианта в «Профиле») хранится на устройстве.
 */
export const DEFAULT_THEME_CHOICE: ThemeChoice = "light";

export function ThemeProvider({ children, initial = DEFAULT_THEME_CHOICE }: { children: ReactNode; initial?: ThemeChoice }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(initial);
  const [hydrated, setHydrated] = useState(false);
  // Студент уже выбрал сам (кнопка «солнце/луна», «Профиль»): его выбор новее того, что лежало на устройстве.
  const chosenNow = useRef(false);
  const system = useColorScheme();

  useEffect(
    () =>
      hydrateFromStorage(STORAGE_KEY, (stored) => {
        // Выбор и флаг ставятся одним обновлением: кадра «готово, но тема ещё не та» не бывает. Запоздавшее чтение (дольше
        // предела ожидания) не перебивает выбор, сделанный за это время (рецензия #1579).
        if (isThemeChoice(stored) && !chosenNow.current) setChoiceState(stored);
        setHydrated(true);
      }),
    [],
  );

  const setChoice = useCallback((next: ThemeChoice) => {
    chosenNow.current = true;
    setChoiceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const scheme = resolveScheme(choice, system === "dark" ? "dark" : "light");
  const value = useMemo<ThemeContextValue>(
    () => ({ choice, setChoice, scheme, tokens: tokensFor(scheme), hydrated }),
    [choice, setChoice, scheme, hydrated],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme вне ThemeProvider");
  return value;
}
