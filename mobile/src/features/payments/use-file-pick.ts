// Выбор файла чека: лист «файл, фото, камера» и то, что идёт за ним. Один порядок на три места страницы «Оплата»
// (чек у строки, чек к принятой оплате, «Добавить платёж»): раньше он был вписан в каждое из них.
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import type { PickedFile, PickSource } from "@/domain/documents-model";
import type { PaymentsIo } from "@/features/payments/io";

/** Системный выбор отказал: камера запрещена («camera») или не удалось взять файл («pick»). */
export type PickNotice = "camera" | "pick" | null;

/** Пока лист закрывается, iOS не показывает системный выбор: ждём `onDismiss`, запасной таймер - на случай, если он не пришёл. */
const IOS_DISMISS_FALLBACK_MS = 700;

/**
 * Состояние выбора файла. `onPicked` вызывается после выбранного файла (экран сбрасывает прежнее сообщение об ошибке).
 * Лист `SourceSheet` получает `sheet`, `onPick`, `closeSheet` и `flush` (`onDismissed`).
 */
export function useFilePick(io: Pick<PaymentsIo, "pick">, onPicked: () => void) {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [sheet, setSheet] = useState(false);
  const [notice, setNotice] = useState<PickNotice>(null);
  const pending = useRef<PickSource | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const runPick = useCallback(
    async (source: PickSource) => {
      setNotice(null);
      const outcome = await io.pick(source);
      if (outcome.kind === "picked") {
        setFile(outcome.file);
        onPicked();
      } else if (outcome.kind === "denied") setNotice("camera");
      else if (outcome.kind === "failed") setNotice("pick");
    },
    [io, onPicked],
  );

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const source = pending.current;
    pending.current = null;
    if (source) void runPick(source);
  }, [runPick]);

  const onPick = useCallback(
    (source: PickSource) => {
      pending.current = source;
      setSheet(false);
      if (Platform.OS === "ios") timer.current = setTimeout(flush, IOS_DISMISS_FALLBACK_MS);
      else flush();
    },
    [flush],
  );

  const openSheet = useCallback(() => setSheet(true), []);
  const closeSheet = useCallback(() => setSheet(false), []);
  const clear = useCallback(() => setFile(null), []);

  return { file, clear, sheet, openSheet, closeSheet, onPick, flush, notice };
}
