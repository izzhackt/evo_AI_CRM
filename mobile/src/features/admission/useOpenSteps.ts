// Раскрытые шаги и свёрнутость пути помнит приложение (в вебе браузер, localStorage).
// Ключ несёт файл и версию контента, как в вебе. Хранилище недоступно: состояние живёт
// в памяти экрана, экран работает.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

/** Общий префикс ключей: при выходе удаляются все ключи с ним (clearPerUserUiState). */
export const OPEN_STEPS_PREFIX = "evo.portal.timeline.open.v1";
const PREFIX = OPEN_STEPS_PREFIX;

/** Ключ принадлежит студенту (auth user id): на общем телефоне чужое состояние не наследуется. */
const scoped = (userKey: string, rest: string) => `${PREFIX}:${userKey}:${rest}`;

/** Удалить всё состояние интерфейса, привязанное к студенту (при выходе). */
export async function clearPerUserUiState(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) => key.startsWith(PREFIX));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // Хранилище недоступно: нечего чистить.
  }
}

export function parseOpenSteps(raw: string | null, known: ReadonlySet<string>): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((id): id is string => typeof id === "string" && known.has(id)));
  } catch {
    return new Set();
  }
}

export function useOpenSteps(
  view: Readonly<{ file: string; contentVersion: number; steps: readonly { id: string }[] }> | null,
  userKey: string,
) {
  const storageKey = view ? scoped(userKey, `${view.file}:${view.contentVersion}`) : null;
  // Путь пересобирается на каждый рендер экрана: зависим от значений, а не от объекта.
  const stepsKey = (view?.steps ?? []).map((step) => step.id).join("|");
  const known = useMemo(() => new Set(stepsKey === "" ? [] : stepsKey.split("|")), [stepsKey]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!storageKey) return;
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!cancelled) setOpen(parseOpenSteps(raw, known));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storageKey, known]);

  const toggle = useCallback(
    (id: string) => {
      setOpen((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        if (storageKey) AsyncStorage.setItem(storageKey, JSON.stringify([...next])).catch(() => undefined);
        return next;
      });
    },
    [storageKey],
  );
  return { open, toggle };
}

/** Свёрнут ли весь путь: выбор студента помнится (`1`/`0`), без выбора по умолчанию. */
export function useFolded(defaultFolded: boolean, userKey: string) {
  const foldedKey = scoped(userKey, "folded");
  // Пока читается ключ нового студента, выбор прежнего не должен просочиться.
  const [stored, setStored] = useState<boolean | null>(null);
  useEffect(() => {
    setStored(null);
    let cancelled = false;
    AsyncStorage.getItem(foldedKey)
      // Выбор, сделанный на экране до ответа хранилища, важнее сохранённого.
      .then((raw) => {
        if (!cancelled) setStored((current) => current ?? (raw === "1" ? true : raw === "0" ? false : null));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [foldedKey]);
  const folded = stored ?? defaultFolded;
  const setFolded = useCallback(
    (value: boolean) => {
      setStored(value);
      AsyncStorage.setItem(foldedKey, value ? "1" : "0").catch(() => undefined);
    },
    [foldedKey],
  );
  return { folded, setFolded };
}
