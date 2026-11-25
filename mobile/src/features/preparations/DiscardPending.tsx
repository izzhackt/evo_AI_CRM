// «Отказаться от незавершённой загрузки / отправки» у документа программы: снять запись ОДНОГО требования после подтверждения.
// Общая часть (кнопка, окно, озвучка, «занято») лежит в `DiscardAction`; здесь только то, что относится к документам: тексты и
// запись, которую снимаем. Снимается только запись этой операции этого требования: другие требования и запись другой операции
// не трогаются (`documentsPending.discard`).
import { usePreparation } from "@/features/preparations/context";
import { DiscardAction } from "@/features/preparations/DiscardAction";
import { documentsPending, type DocumentOperation } from "@/features/preparations/documents-pending";
import { useLang } from "@/i18n/LangProvider";

export function DiscardPending({ operation, target, disabled = false, onDiscarded, testID }: {
  operation: DocumentOperation;
  /** Требование, чья запись снимается. */
  target: string;
  /** Идёт действие над этим требованием, или запись ещё не прочитана. */
  disabled?: boolean;
  /** Запись снята; текст уже озвучен, а форма может показать его у себя (сама кнопка после снятия исчезает). */
  onDiscarded?: (text: string) => void;
  testID: string;
}) {
  const { scope } = usePreparation();
  const { m } = useLang();
  return (
    <DiscardAction
      label={m(operation === "upload" ? "prep.discardUpload" : "prep.discardSubmit")}
      body={m(operation === "upload" ? "prep.discardUploadBody" : "prep.discardSubmitBody")}
      discard={() => documentsPending.discard(scope, operation, target)}
      disabled={disabled}
      onDiscarded={onDiscarded}
      testID={testID}
    />
  );
}
