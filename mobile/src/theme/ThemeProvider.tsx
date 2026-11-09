import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

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
}>;

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, initial = "system" }: { children: ReactNode; initial?: ThemeChoice }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(initial);
  const system = useColorScheme();

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (isThemeChoice(stored)) setChoiceState(stored);
      })
      .catch(() => undefined);
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const scheme = resolveScheme(choice, system === "dark" ? "dark" : "light");
  const value = useMemo<ThemeContextValue>(
    () => ({ choice, setChoice, scheme, tokens: tokensFor(scheme) }),
    [choice, setChoice, scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme вне ThemeProvider");
  return value;
}
