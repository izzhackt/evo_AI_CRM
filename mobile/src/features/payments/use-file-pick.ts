// Выбор файла чека: лист «файл, фото, камера» и то, что идёт за ним. Один порядок на три места страницы «Оплата»
// (чек у строки, чек к принятой оплате, «Добавить платёж»): раньше он был вписан в каждое из них.
// Файл проверяется сразу при выборе, как на сайте (PaymentReceiptForm.tsx, `pick`): чужой тип или слишком большой файл не
// становится выбранным, студент видит причину под кнопкой, а не после «Сохранить».
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { PortalStrings } from "@web/lib/portal/i18n";

import { checkPickedFile, type PickedFile, type PickSource } from "@/domain/documents-model";
import type { PaymentsIo } from "@/features/payments/io";
import { fileCheckErrorKey } from "@/features/payments/receipt-upload";
import type { MobileStringKey } from "@/i18n";

/**
 * Что пошло не так при выборе: камера запрещена («camera»), не удалось взять файл («pick») или файл не подошёл
 * (ключ строки сайта: чужой тип, слишком большой или пустой).
 */
export type PickNotice = "camera" | "pick" | "receiptErrorFileType" | "receiptErrorTooLarge" | null;

/** Пока лист закрывается, iOS не показывает системный выбор: ждём `onDismiss`, запасной таймер - на случай, если он не пришёл. */
const IOS_DISMISS_FALLBACK_MS = 700;

/** Слова причины выбора: свои для камеры и сбоя выбора, остальные - из словаря сайта. */
export function pickNoticeText(notice: PickNotice, m: (key: MobileStringKey) => string, strings: PortalStrings<"admission">): string | null {
  if (notice === null) return null;
  return notice === "camera" ? m("docs.cameraDenied") : notice === "pick" ? m("docs.errorPick") : strings[notice];
}

/**
 * Состояние выбора файла. `onPicked` вызывается после выбранного (подходящего) файла: экран сбрасывает прежнее сообщение об ошибке.
 * `pickedAt` - момент выбора: от него считается день чека у строки, и он не меняется, пока файл тот же (см. `receiptInputForLine`).
 * Лист `SourceSheet` получает `sheet`, `onPick`, `closeSheet` и `flush` (`onDismissed`).
 */
export function useFilePick(io: Pick<PaymentsIo, "pick">, onPicked: () => void) {
  const [picked, setPicked] = useState<Readonly<{ file: PickedFile; at: number }> | null>(null);
  const [sheet, setSheet] = useState(false);
  const [notice, setNotice] = useState<PickNotice>(null);
  // Каждый отказ выбора - событие, даже если причина та же (камера запрещена дважды): читалка слышит его каждый раз.
  const [noticeSeq, setNoticeSeq] = useState(0);
  const pending = useRef<PickSource | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const raise = useCallback((value: Exclude<PickNotice, null>) => {
    setNotice(value);
    setNoticeSeq((count) => count + 1);
  }, []);

  const runPick = useCallback(
    async (source: PickSource) => {
      setNotice(null);
      const outcome = await io.pick(source);
      if (outcome.kind === "picked") {
        const checked = checkPickedFile(outcome.file);
        if (!checked.ok) {
          // Как на сайте: негодный файл не выбирается, прежний выбор сбрасывается, причина остаётся на виду.
          setPicked(null);
          raise(fileCheckErrorKey(checked.reason));
          return;
        }
        setPicked({ file: outcome.file, at: Date.now() });
        onPicked();
      } else if (outcome.kind === "denied") raise("camera");
      else if (outcome.kind === "failed") raise("pick");
    },
    [io, onPicked, raise],
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
  const clear = useCallback(() => setPicked(null), []);

  return { file: picked?.file ?? null, pickedAt: picked?.at ?? null, clear, sheet, openSheet, closeSheet, onPick, flush, notice, noticeSeq };
}
