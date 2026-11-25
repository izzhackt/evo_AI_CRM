// Документ одного требования программы: сохранённый файл, загрузка, выбор сохранённой версии, отправка на проверку,
// отправленный документ с решением EVO, «По предыдущим требованиям» и история. Веб: `ProgramDocumentItem.tsx`.
//
// Устройство как у сайта: снимок документа пересоздаёт форму при любом изменении (ключ от содержимого снимка), поэтому
// итог одного нажатия (`notice`), идущее нажатие (`oneTapRun`) и отправка кнопкой («Отправить на проверку») лежат уровнем
// выше и переживают пересоздание. Неоконченные записи лежат в хранилище запросов вне экрана и сохраняют свои исходные запросы.
import {
  applicationDocumentNoticeVisible,
  nextOneTapRun,
  type ApplicationDocumentNotice,
} from "@web/lib/portal/application-documents-one-tap";
import type { ApplicationDocumentItemState, ApplicationDocumentItemTarget, ApplicationDocumentSelection } from "@web/lib/portal/application-documents";
import { useState } from "react";
import { View } from "react-native";

import { Collapsible } from "@/features/preparations/Collapsible";
import { HistoryEvidence, DocumentHistory } from "@/features/preparations/DocumentHistory";
import { documentsPending, isSubmitIntent } from "@/features/preparations/documents-pending";
import { usePreparation } from "@/features/preparations/context";
import { Block, FileFacts, SubmissionFacts } from "@/features/preparations/ItemDocumentState";
import { itemDocumentView } from "@/features/preparations/model";
import { usePending } from "@/features/preparations/pending-store";
import { SavedVersions, useSavedVersions } from "@/features/preparations/SavedVersions";
import { SubmitControl } from "@/features/preparations/SubmitControl";
import { UploadControl, type SendAfterSave } from "@/features/preparations/UploadControl";
import { Text } from "@/ui/Text";

type ItemProps = Readonly<{
  /** Название требования: подпись листа выбора файла. */
  label: string;
  state: ApplicationDocumentItemState;
  target: ApplicationDocumentItemTarget;
}>;

export function DocumentItem(props: ItemProps) {
  // Новый снимок с сервера отменяет постраничные выборы, сделанные на прежнем. Неоконченные записи живут вне формы.
  const key = JSON.stringify([props.target, props.state.savedDraft, props.state.submission, props.state.reusableVersions, props.state.previousEvidence]);
  // «Отправлено» и «сохранён, не отправлен» должны пережить пересоздание формы, которое вызывает обновление после записи.
  const [notice, setNotice] = useState<ApplicationDocumentNotice | null>(null);
  // Идущее нажатие, чтобы пересоздание посреди него не приняло его запрос отправки за неоконченный.
  const [oneTapRun, setOneTapRun] = useState<SendAfterSave | null>(null);
  const onOneTapRun = (run: SendAfterSave, active: boolean) => setOneTapRun((current) => nextOneTapRun(current, run, active));
  // Отправка кнопкой «Отправить на проверку» по той же причине: записанный ею запрос не неоконченный.
  const [standaloneSending, setStandaloneSending] = useState(false);
  return (
    <DocumentItemSnapshot
      key={key}
      {...props}
      notice={notice}
      onNotice={setNotice}
      oneTapRun={oneTapRun}
      onOneTapRun={onOneTapRun}
      standaloneSending={standaloneSending}
      onStandaloneSending={setStandaloneSending}
    />
  );
}

function DocumentItemSnapshot({ label, state, target, notice, onNotice, oneTapRun, onOneTapRun, standaloneSending, onStandaloneSending }: ItemProps & {
  notice: ApplicationDocumentNotice | null;
  onNotice: (notice: ApplicationDocumentNotice | null) => void;
  oneTapRun: SendAfterSave | null;
  onOneTapRun: (run: SendAfterSave, active: boolean) => void;
  standaloneSending: boolean;
  onStandaloneSending: (busy: boolean) => void;
}) {
  const { strings, scope, epoch, stale } = usePreparation();
  const view = itemDocumentView(state);
  // На устаревшем виде (чтение не удалось, прежний ответ остался на экране) новые действия закрыты: загрузка и отправка опираются
  // на то, что студент видит, а сервер ответил бы «документ изменился». Неоконченные записи (они идемпотентны) доводятся как обычно.
  const canSubmit = state.canSubmit && !stale;
  const draft = view.unsubmittedDraft;
  const saved = useSavedVersions(state, target);
  const [selected, setSelected] = useState<string | null>(null);
  const selectable = saved.versions.filter((version) => version.file.documentVersionId !== state.submission?.file.documentVersionId);
  const chosen = selected ? (selectable.find((version) => version.file.documentVersionId === selected) ?? null) : null;
  const selection: ApplicationDocumentSelection | null = chosen
    ? chosen.selection
    : draft
      ? { kind: "program_upload", uploadContextId: draft.uploadContextId, documentVersionId: draft.file.documentVersionId }
      : null;
  const selectionAvailable = (chosen?.file ?? draft?.file)?.technicalAvailability === "available";
  // Студент, которому можно отправлять: сохранение файла сразу отправляет его. Неоконченная прежняя отправка завершается своей кнопкой.
  const submitPending = usePending(documentsPending, scope, "submit", target.requirementItemId);
  // Пока идёт одно нажатие или отправка кнопкой, записанный ими запрос отправки - их собственный: вид требования не меняется.
  const sending = oneTapRun !== null || standaloneSending;
  const sendAfterSave: SendAfterSave | undefined =
    oneTapRun ?? (canSubmit && submitPending.hydrated && (!isSubmitIntent(submitPending.intent) || standaloneSending) && !submitPending.blocked ? { previousSubmissionId: state.submission?.submissionId ?? null } : undefined);
  // Подтверждение «отправлено» держится, пока свежий снимок не скажет другого. Если после отправки чтение не удалось (вид устарел),
  // снимок прежний и подтвердить отправку не может, но сервер её подтвердил квитанцией: слово студенту остаётся, а пометка
  // «Не удалось обновить» объясняет, почему рядом прежний вид (иначе успех пропал бы вместе с закрытой формой).
  const noticeShown =
    notice !== null &&
    (applicationDocumentNoticeVisible(notice, {
      submittedVersionId: state.submission?.file.documentVersionId ?? null,
      reviewed: Boolean(state.submission?.review),
      unsentDraftVersionId: draft ? draft.file.documentVersionId : null,
    }) ||
      (stale && notice.tone === "success"));
  const heading = state.submission?.review && state.submission.review.decision !== "approved" ? strings.correctFile : draft || state.submission ? strings.replaceFile : strings.chooseFile;

  return (
    <View style={{ gap: 12 }} testID={`prep-document-${target.requirementItemId}`}>
      {draft ? (
        <Block heading={strings.savedOnly} testID={`prep-document-${target.requirementItemId}-draft`}>
          <FileFacts file={draft.file} strings={strings} target={target} testID={`prep-document-${target.requirementItemId}-draft-file`} />
          {view.newerDraft ? (
            <Text variant="secondary" tone="text2">
              {strings.newDraftHint}
            </Text>
          ) : null}
        </Block>
      ) : view.noFile ? (
        <Text variant="secondary" tone="text2">
          {strings.noFile}
        </Text>
      ) : null}

      {state.canUpload ? (
        <View style={{ gap: 6 }}>
          {/* Устаревший вид: заголовок и подсказка убраны вместе с кнопкой, а сама форма остаётся тем же экземпляром (не пересоздаётся посреди загрузки). */}
          {stale ? null : (
            <>
              <Text variant="body" bold>
                {heading}
              </Text>
              <Text variant="secondary" tone="text2">
                {sendAfterSave ? strings.saveHintOneTap : strings.saveHint}
              </Text>
            </>
          )}
          <UploadControl target={target} label={label} sendAfterSave={sendAfterSave} quiet={selection !== null} itemSending={sending} onNotice={onNotice} onSendingChange={onOneTapRun} disabled={stale} />
        </View>
      ) : (
        <UploadControl target={target} label={label} sendAfterSave={sendAfterSave} quiet={selection !== null} itemSending={sending} onNotice={onNotice} onSendingChange={onOneTapRun} disabled />
      )}

      {selectable.length || saved.cursor ? (
        <SavedVersions
          target={target}
          versions={selectable}
          cursor={saved.cursor}
          loading={saved.loading}
          failed={saved.failed}
          onMore={() => void saved.more()}
          selected={selected}
          onSelect={setSelected}
        />
      ) : null}

      {noticeShown && notice ? (
        <Text variant="secondary" tone={notice.tone === "success" ? "text2" : "error"} accessibilityRole={notice.tone === "success" ? undefined : "alert"} testID={`prep-document-notice-${target.requirementItemId}`}>
          {notice.text}
        </Text>
      ) : null}
      <SubmitControl
        target={target}
        selection={selection}
        previousSubmissionId={state.submission?.submissionId ?? null}
        disabled={!canSubmit || !selectionAvailable}
        suppressed={sending}
        confirmationShown={noticeShown && notice?.tone === "success"}
        onAttempt={() => onNotice(null)}
        onSent={(versionId, text) => onNotice({ tone: "success", text, versionId })}
        onBusyChange={onStandaloneSending}
      />

      {state.submission ? <SubmissionFacts submission={state.submission} strings={strings} target={target} testID={`prep-document-${target.requirementItemId}-submission`} /> : null}
      {state.previousEvidence ? (
        <Collapsible title={strings.previous} testID={`prep-previous-${target.requirementItemId}`}>
          <Text variant="secondary" tone="text2">
            {strings.previousHint}
          </Text>
          <HistoryEvidence entry={state.previousEvidence} />
        </Collapsible>
      ) : null}
      <DocumentHistory key={epoch} requirementItemId={target.requirementItemId} testID={`prep-history-${target.requirementItemId}`} />
    </View>
  );
}
