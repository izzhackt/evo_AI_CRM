// Раскрытые шаги и свёрнутость пути помнит приложение (в вебе браузер, localStorage).
// Ключ несёт файл и версию контента, как в вебе. Хранилище недоступно: состояние живёт
// в памяти экрана, экран работает.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

const PREFIX = "evo.portal.timeline.open.v1";

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

export function useOpenSteps(view: Readonly<{ file: string; contentVersion: number; steps: readonly { id: string }[] }> | null) {
  const storageKey = view ? `${PREFIX}:${view.file}:${view.contentVersion}` : null;
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

const FOLDED_KEY = `${PREFIX}:folded`;

/** Свёрнут ли весь путь: выбор студента помнится (`1`/`0`), без выбора по умолчанию. */
export function useFolded(defaultFolded: boolean) {
  const [stored, setStored] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(FOLDED_KEY)
      // Выбор, сделанный на экране до ответа хранилища, важнее сохранённого.
      .then((raw) => setStored((current) => current ?? (raw === "1" ? true : raw === "0" ? false : null)))
      .catch(() => undefined);
  }, []);
  const folded = stored ?? defaultFolded;
  const setFolded = useCallback((value: boolean) => {
    setStored(value);
    AsyncStorage.setItem(FOLDED_KEY, value ? "1" : "0").catch(() => undefined);
  }, []);
  return { folded, setFolded };
}
