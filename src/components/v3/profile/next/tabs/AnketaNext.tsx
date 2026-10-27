import { Suspense } from "react";

import { CARD_FRAME } from "@/components/kit/card-classes";
import { KeyFacts } from "@/components/kit/KeyFacts";
import { formatStudentApplicationAnswers, submittedDate } from "@/lib/student-application-presentation";

import { StudentProfileFields } from "../../StudentProfileFields";
import type { PersonProfile, ProfileDraft } from "../../types";
import { MoreSheet } from "../MoreSheet";
import { NamedCard } from "../NamedCard";
import { AnketaOtherFacts, AnketaOtherFactsLoader, interestNeeded, otherFactsShown } from "./AnketaOtherFacts";

type Props = Readonly<{
  profile: PersonProfile;
  draft: ProfileDraft;
  fieldsRequestId: string;
  fieldsReadOnly: boolean;
  documentsHref: string | null;
  routeHref: string | null;
}>;

/**
 * Вкладка «Анкета» в «Новом виде»: «Заполнено студентом» (ответы анкеты платформы данными, «требуют проверки» - за «?»),
 * «Анкета студента» (прежняя форма проверки полей и файлов в карточках набора: `StudentProfileFields nextUi`) и «Другие сведения
 * дела» - карточкой, а когда есть форма полей, кнопкой с панелью. Данные, права и команды те же, что у прежней вкладки.
 */
export function AnketaNext({ profile, draft, fieldsRequestId, fieldsReadOnly, documentsHref, routeHref }: Props) {
  const application = draft.studentApplication;
  const other = otherFactsShown(profile, draft);
  // «Интересует» читается отдельно: пока оно читается, на месте строка о загрузке, остальная вкладка рисуется сразу.
  const otherFacts = interestNeeded(profile)
    ? <Suspense fallback={<p role="status" className="t-body-compact text-fg-3">Загружаем…</p>}><AnketaOtherFactsLoader profile={profile} draft={draft} /></Suspense>
    : <AnketaOtherFacts profile={profile} draft={draft} interest={null} />;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4" data-testid="v3-anketa">
      {application ? (
        <NamedCard
          title="Заполнено студентом"
          testId="v3-anketa-answers"
          help="Сведения требуют проверки: сверьте их с документами."
          actions={<span className="t-meta text-fg-3">Отправлено {submittedDate(application.submittedAt)}</span>}
        >
          <KeyFacts columns={2} facts={[...formatStudentApplicationAnswers(application.questionnaire), { label: "Почта", value: application.email }]} />
        </NamedCard>
      ) : null}
      {draft.profileFields ? (
        <StudentProfileFields
          key={draft.profileFields.studentCaseId}
          cardClass={CARD_FRAME}
          snapshot={draft.profileFields}
          requestId={fieldsRequestId}
          applications={profile.applications.map(({ id, institution, program }) => ({ id, institution, program }))}
          readOnly={fieldsReadOnly}
          sourceVersions={draft.profileFieldSources}
          documentsHref={documentsHref}
          routeHref={routeHref}
        />
      ) : null}
      {other && draft.profileFields ? (
        <MoreSheet label="Другие сведения дела" title="Другие сведения дела" testId="v3-anketa-other-open">
          {otherFacts}
        </MoreSheet>
      ) : null}
      {other && !draft.profileFields ? (
        <NamedCard title="Другие сведения дела" testId="v3-anketa-other-card">{otherFacts}</NamedCard>
      ) : null}
      {!other && !application && !draft.profileFields ? <p className="t-body-compact text-fg-2">Других сведений нет.</p> : null}
    </div>
  );
}
