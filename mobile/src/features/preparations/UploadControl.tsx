// «Загрузить и отправить на проверку» / «Сохранить файл» у одного требования. Веб: `ProgramDocumentUpload` в
// `ProgramDocumentControls.tsx`. Файл берётся через лист «файл, фото, камера»; дальше как на сайте: замок цели, запрос
// записывается ДО сети, одно нажатие студента, которому можно отправлять, сохраняет файл и отправляет именно эту версию.
// Неоконченная загрузка ждёт того же файла ещё раз («Проверить результат»): повтор идёт с тем же `requestId`.
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, View } from "react-native";
import type { ApplicationDocumentItemTarget } from "@web/lib/portal/application-documents";
import type { ApplicationDocumentNotice } from "@web/lib/portal/application-documents-one-tap";

import { usePortalApi } from "@/api/PortalApi";
import { submitApplicationDocument } from "@/api/preparations-documents";
import type { PickedFile } from "@/domain/documents-model";
import { SourceSheet } from "@/features/documents/SourceSheet";
import { DiscardPending } from "@/features/preparations/DiscardPending";
import { runUploadAndSubmit } from "@/features/preparations/document-commands";
import { documentsPending, isUploadIntent } from "@/features/preparations/documents-pending";
import { usePreparation } from "@/features/preparations/context";
import { sendFailureMessage, uploadFailureMessage, uploadWasStopped } from "@/features/preparations/messages";
import { usePending } from "@/features/preparations/pending-store";
import { useSourcePicker, type PickNotice } from "@/features/preparations/use-source-picker";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { LinkButton } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Одно нажатие студента, которому можно отправлять: значения на момент нажатия (веб: `ProgramDocumentSendAfterSave`). */
export type SendAfterSave = Readonly<{ previousSubmissionId: string | null }>;

export function UploadControl({ target, label, sendAfterSave, quiet = false, disabled = false, itemSending = false, onNotice, onSendingChange }: {
  target: ApplicationDocumentItemTarget;
  /** Название требования: подпись листа выбора файла. */
  label: string;
  /** Студент, которому можно отправлять: одно нажатие сохраняет файл и отправляет его. */
  sendAfterSave?: SendAfterSave;
  /** Главным действием сейчас стоит отправка сохранённого файла. */
  quiet?: boolean;
  /** Загрузка закрыта: форма видна только при неоконченной загрузке. */
  disabled?: boolean;
  /** Одно нажатие этого требования идёт, возможно в предыдущем показе формы. */
  itemSending?: boolean;
  /** Итог одного нажатия, который должен пережить обновление после записи. */
  onNotice?: (notice: ApplicationDocumentNotice | null) => void;
  onSendingChange?: (run: SendAfterSave, active: boolean) => void;
}) {
  const { scope, io, strings, onSaved } = usePreparation();
  const api = usePortalApi();
  const { format, m } = useLang();
  const { tokens } = useTheme();
  const pending = usePending(documentsPending, scope, "upload", target.requirementItemId);
  const sending = useRef(false);
  // Останавливает идущую загрузку («Отменить загрузку»): по одному на нажатие, пока оно идёт.
  const stopper = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<"upload" | "submit" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  // Студент остановил загрузку: текст спокойный (не ошибка), а неоконченная запись, если она осталась, видна как обычно.
  const [stopped, setStopped] = useState(false);
  const [pickNotice, setPickNotice] = useState<PickNotice | null>(null);
  const upload = useMemo(() => io.createUploader(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), [io, api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken]);

  const retained = isUploadIntent(pending.intent) ? pending.intent : null;
  // Нечитаемая (повреждённая) запись: повтор не поможет, её можно только снять. «Хранилище не ответило» - другое состояние.
  const corrupt = pending.blocked && !pending.unavailable;
  const busy = stage !== null;
  // Обновление после записи пересоздало форму, а одно нажатие этого требования ещё идёт: ждём его, второе не начинаем.
  const elsewhere = itemSending && !busy;
  // Запрос, записанный этой же формой секунду назад, - её собственный, а не неоконченный прежний.
  const shownRetained = busy || elsewhere ? null : retained;
  const oneTap = Boolean(sendAfterSave);

  async function save(file: PickedFile) {
    // Два ответа выбора файла в одном кадре (форма ещё не успела выключиться): вторую остановит `sending`, раньше замка цели.
    // Без этой строки вторая дошла бы до замка, получила «занято» и сказала бы «Не уверены, дошёл ли файл» поверх идущей загрузки.
    if (sending.current || elsewhere || pending.blocked || !pending.hydrated || (disabled && !retained)) return;
    sending.current = true;
    const abort = new AbortController();
    stopper.current = abort;
    setStage("upload");
    setProgress(null);
    setMessage(null);
    setSucceeded(false);
    setStopped(false);
    try {
      onNotice?.(null);
    } catch {
      // Показ только.
    }
    // Свежий объект на каждое нажатие: «отправляется» у требования снимает только то нажатие, которое его поставило.
    const run = oneTap && sendAfterSave ? { previousSubmissionId: sendAfterSave.previousSubmissionId } : null;
    if (run) {
      try {
        onSendingChange?.(run, true);
      } catch {
        // Показ только.
      }
    }
    let saved = false;
    try {
      const outcome = await runUploadAndSubmit({
        scope,
        target,
        file,
        fingerprint: io.fingerprint,
        upload,
        onStage: setStage,
        onProgress: setProgress,
        signal: abort.signal,
        sendAfterUpload: run ? { previousSubmissionId: run.previousSubmissionId, submit: (intent) => submitApplicationDocument(api.transport, intent) } : null,
      });
      if (outcome.stage === "upload") {
        // Студент нажал «Отменить загрузку»: так и сказать, а не «Не удалось получить результат». Если отправка уже началась, запись
        // осталась, и ниже она показана как неоконченная загрузка («Проверить результат»).
        const byStudent = abort.signal.aborted && uploadWasStopped(outcome.upload);
        const text = byStudent ? m("docs.uploadCancelled") : uploadFailureMessage(outcome.upload, strings, { unreadable: m("prep.fileUnreadable") });
        setStopped(byStudent);
        setMessage(text);
        announce(text);
        return;
      }
      saved = true;
      const { upload: uploaded, submit } = outcome;
      const failure = sendFailureMessage(submit, strings);
      if (failure !== null) {
        // Файл сохранён, а отправка не прошла: после обновления он виден с обычной кнопкой «Отправить».
        if (onNotice) onNotice({ tone: "error", text: failure, versionId: uploaded.receipt.documentVersionId });
        else setMessage(failure);
        announce(failure);
      } else {
        const sent = submit.status === "sent";
        const cleaned = uploaded.cleared && (submit.status !== "sent" || submit.cleared);
        const text = `${sent ? strings.sent : strings.saved}${cleaned ? "" : ` ${strings.cleanupFailed}`}`;
        setSucceeded(true);
        setMessage(text);
        announce(text);
        if (sent) {
          try {
            onNotice?.({ tone: "success", text, versionId: uploaded.receipt.documentVersionId });
          } catch {
            // Показ только.
          }
        }
      }
    } catch {
      setMessage(strings.unavailable);
      announce(strings.unavailable);
    } finally {
      sending.current = false;
      stopper.current = null;
      setStage(null);
      setProgress(null);
      if (run) {
        try {
          onSendingChange?.(run, false);
        } catch {
          // Показ только.
        }
      }
      // Одно обновление после всей последовательности: пересоздание формы посреди отправки оборвало бы её показ.
      if (saved) {
        try {
          onSaved();
        } catch {
          // Подтверждённая квитанция остаётся подтверждённой, даже если обновление не вышло.
        }
      }
    }
  }
  // Выбор файла занимает секунды, за это время форма перерисовывается: сохранить нужно с самыми свежими защитами (замок, запись, занятость).
  const latestSave = useRef(save);
  useEffect(() => {
    latestSave.current = save;
  });
  // Сбой выбора файла (камера не разрешена, система не отдала файл) читалка узнаёт сама: «alert» без объявления молчит на iPhone.
  const onPickNotice = (notice: PickNotice | null) => {
    setPickNotice(notice);
    if (notice) announce(notice.kind === "camera" ? m("docs.cameraDenied") : m("docs.errorPick"));
  };
  const picker = useSourcePicker({ pick: io.pick, onPicked: (file) => void latestSave.current(file), onNotice: onPickNotice });

  if (disabled && !retained && !pending.blocked) return null;
  const inert = !pending.hydrated || busy || elsewhere || pending.blocked || (disabled && !retained);
  // Запись загрузки ждёт результата и ничего не идёт: главная кнопка «Проверить результат», у неё своё имя для читалки (рядом может стоять такая же у отправки).
  const retrying = !busy && !elsewhere && retained !== null;
  const buttonLabel =
    stage === "submit" || elsewhere ? strings.sending : stage === "upload" ? (oneTap ? strings.uploading : strings.saving) : retained ? strings.retry : oneTap ? strings.uploadAndSend : strings.saveFile;
  return (
    <View style={{ gap: 8 }} accessibilityState={{ busy: busy || elsewhere }} testID={`prep-upload-${target.requirementItemId}`}>
      <Text variant="caption" tone="text2">
        {shownRetained ? strings.reselectFile : strings.formats}
      </Text>
      {shownRetained && !succeeded ? (
        <Text variant="secondary" testID={`prep-upload-retained-${target.requirementItemId}`}>
          {strings.pending} <Text variant="secondary" bold>{shownRetained.file.originalFilename}</Text>
        </Text>
      ) : null}
      {corrupt ? (
        <Text variant="secondary" tone="error" accessibilityRole="alert" testID={`prep-upload-unreadable-${target.requirementItemId}`}>
          {m("prep.recordUnreadable")}
        </Text>
      ) : null}
      {/* Хранилище не ответило: запись, возможно, цела. Повтор позже может помочь, поэтому отказа здесь нет. */}
      {pending.unavailable ? (
        <Text variant="secondary" tone="error" accessibilityRole="alert" testID={`prep-upload-storage-${target.requirementItemId}`}>
          {strings.storageUnavailable}
        </Text>
      ) : null}
      <Button
        variant={oneTap && !quiet ? "primary" : "ghost"}
        label={buttonLabel}
        accessibilityLabel={retrying ? m("prep.retryUploadAria") : undefined}
        onPress={picker.open}
        disabled={inert}
        testID={`prep-upload-button-${target.requirementItemId}`}
      />
      {/* Запись ждёт ТОТ ЖЕ файл (снимок с камеры повторить нельзя) или не читается: выход - отказаться и начать заново. */}
      {shownRetained || corrupt ? (
        <DiscardPending
          operation="upload"
          target={target.requirementItemId}
          disabled={!pending.hydrated || busy || elsewhere}
          onDiscarded={(text) => {
            setMessage(text);
            setSucceeded(true);
          }}
          testID={`prep-discard-upload-${target.requirementItemId}`}
        />
      ) : null}
      {stage === "upload" && progress !== null ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={format(m("prep.progress"), { percent: String(Math.round(progress)) })} accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }} style={{ height: 6, borderRadius: 3, backgroundColor: tokens.skeleton, overflow: "hidden" }}>
          <View style={{ width: `${Math.round(progress)}%`, height: 6, backgroundColor: tokens.accent }} />
        </View>
      ) : null}
      {/* Загрузка идёт, а связи нет или она оборвалась: выход есть всегда. После подтверждённой квитанции (идёт отправка) отменять нечего. */}
      {stage === "upload" ? <Button variant="ghost" label={m("docs.cancelUpload")} onPress={() => stopper.current?.abort()} testID={`prep-upload-cancel-${target.requirementItemId}`} /> : null}
      {pickNotice ? (
        <View style={{ gap: 4 }}>
          <Text variant="secondary" tone="error" accessibilityRole="alert" testID={`prep-pick-notice-${target.requirementItemId}`}>
            {pickNotice.kind === "camera" ? m("docs.cameraDenied") : m("docs.errorPick")}
          </Text>
          {pickNotice.kind === "camera" && !pickNotice.canAskAgain ? <LinkButton label={m("docs.openSettings")} onPress={() => void Linking.openSettings()} /> : null}
        </View>
      ) : null}
      {message ? (
        <Text variant="secondary" tone={succeeded || stopped ? "text2" : "error"} accessibilityRole={succeeded || stopped ? undefined : "alert"} testID={`prep-upload-message-${target.requirementItemId}`}>
          {message}
        </Text>
      ) : null}
      <SourceSheet visible={picker.visible} title={label} onPick={picker.onPick} onClose={picker.close} onDismissed={picker.onDismissed} />
    </View>
  );
}
