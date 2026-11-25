// Выбор файла через лист «файл, фото, камера» (`features/documents/SourceSheet.tsx`) для документов программы. Порядок как у
// строки экрана «Документы»: лист закрывается, а системный выбор открывается после его закрытия (iOS не показывает выбор,
// пока лист ещё на экране; запасной таймер на случай, если событие закрытия не пришло).
import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";

import type { PickSource, PickedFile } from "@/domain/documents-model";
import type { PreparationIo } from "@/features/preparations/io";

/** Что пошло не так с самим выбором (не с загрузкой). */
export type PickNotice = Readonly<{ kind: "camera"; canAskAgain: boolean }> | Readonly<{ kind: "pick" }>;

export const IOS_PICK_FALLBACK_MS = 700;

export function useSourcePicker(options: Readonly<{ pick: PreparationIo["pick"]; onPicked: (file: PickedFile) => void; onNotice: (notice: PickNotice | null) => void }>) {
  const { pick, onPicked, onNotice } = options;
  const [visible, setVisible] = useState(false);
  const pending = useRef<PickSource | null>(null);

  const run = useCallback(
    async (source: PickSource) => {
      onNotice(null);
      const outcome = await pick(source);
      if (outcome.kind === "picked") onPicked(outcome.file);
      else if (outcome.kind === "denied") onNotice({ kind: "camera", canAskAgain: outcome.canAskAgain });
      else if (outcome.kind === "failed") onNotice({ kind: "pick" });
    },
    [pick, onPicked, onNotice],
  );
  const flush = useCallback(() => {
    const source = pending.current;
    pending.current = null;
    if (source) void run(source);
  }, [run]);
  const onPick = useCallback(
    (source: PickSource) => {
      pending.current = source;
      setVisible(false);
      if (Platform.OS === "ios") setTimeout(flush, IOS_PICK_FALLBACK_MS);
      else flush();
    },
    [flush],
  );
  return { visible, open: () => setVisible(true), close: () => setVisible(false), onPick, onDismissed: flush };
}
