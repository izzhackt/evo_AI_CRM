/** The shared public contract. Editorial playbooks never confer immigration eligibility. */
export const ADMISSIONS_DIRECTIONS = ['CN', 'MY', 'EUROPE', 'AE', 'TR'] as const;
export type AdmissionsDirection = typeof ADMISSIONS_DIRECTIONS[number];
export const ADMISSIONS_ATTENTION = ['overdue', 'awaiting_partner', 'submitted', 'decisions', 'visas', 'arrivals', 'awaiting_ack'] as const;
export type AdmissionsAttention = typeof ADMISSIONS_ATTENTION[number];
export const ADMISSIONS_STAGES = ['intake', 'profile_and_route', 'documents', 'applications', 'decisions', 'visa_and_predeparture', 'arrival_and_adaptation'] as const;
export type AdmissionsStage = typeof ADMISSIONS_STAGES[number];
export const ADMISSIONS_STAGE_LABELS: Record<AdmissionsStage, string> = {
  intake: 'Приём дела', profile_and_route: 'Выбор программы', documents: 'Документы',
  applications: 'Подача через партнёра', decisions: 'Решение университета',
  visa_and_predeparture: 'Виза', arrival_and_adaptation: 'Поездка и прибытие',
};
export type AdmissionsOutcome = 'active' | 'arrived' | 'cancelled';
export type AdmissionsField = { key: string; label: string; section: string; kind: 'text' | 'date' | 'enum'; options?: readonly string[] };
const applicability = ['needs_confirmation', 'required', 'not_required'] as const;
const evidenceStatus = ['pending', 'confirmed', 'not_required'] as const;

/** Empty fields are omitted, not stored as invented facts. Dates are calendar dates. */
export const ADMISSIONS_CASE_FIELDS: readonly AdmissionsField[] = [
  { key: 'referralAgency', label: 'Агентство — источник клиента', section: 'Приём дела', kind: 'text' },
  { key: 'contactConfirmedOn', label: 'Контакт с клиентом подтверждён', section: 'Приём дела', kind: 'date' },
  { key: 'serviceScopeEvidence', label: 'Подтверждённый объём услуги: основание', section: 'Приём дела', kind: 'text' },
  { key: 'campus', label: 'Кампус', section: 'Выбор программы', kind: 'text' },
  { key: 'intake', label: 'Набор', section: 'Выбор программы', kind: 'text' },
  { key: 'programme', label: 'Выбранная программа', section: 'Выбор программы', kind: 'text' },
  { key: 'selectionConfirmedOn', label: 'Дата согласования выбора', section: 'Выбор программы', kind: 'date' },
  { key: 'selectionConfirmedBy', label: 'Кто согласовал выбор', section: 'Выбор программы', kind: 'text' },
  { key: 'selectionEvidence', label: 'Основание согласованного выбора', section: 'Выбор программы', kind: 'text' },
  { key: 'housingApplicability', label: 'Нужно ли жильё', section: 'Жильё', kind: 'enum', options: applicability },
  { key: 'housingNotRequiredReason', label: 'Почему подбор жилья не нужен', section: 'Жильё', kind: 'text' },
  { key: 'housingBudget', label: 'Пожелание по бюджету жилья', section: 'Жильё', kind: 'text' },
  { key: 'housingCurrency', label: 'Валюта бюджета жилья', section: 'Жильё', kind: 'text' },
  { key: 'housingCampus', label: 'Кампус для подбора жилья', section: 'Жильё', kind: 'text' },
  { key: 'housingMoveInOn', label: 'Плановая дата заселения', section: 'Жильё', kind: 'date' },
  { key: 'housingApprovedOption', label: 'Согласованный вариант жилья', section: 'Жильё', kind: 'text' },
  { key: 'housingApprovedOn', label: 'Дата согласования жилья', section: 'Жильё', kind: 'date' },
  { key: 'housingContractTerms', label: 'Условия договора жилья', section: 'Жильё', kind: 'text' },
  { key: 'housingDepositTerms', label: 'Условия депозита (не подтверждение оплаты)', section: 'Жильё', kind: 'text' },
  { key: 'housingBookingEvidence', label: 'Подтверждение бронирования', section: 'Жильё', kind: 'text' },
  { key: 'financeReferences', label: 'Ссылки на счета, обязательства и квитанции в Finance', section: 'Оплата', kind: 'text' },
  { key: 'departureOn', label: 'Дата выезда', section: 'Поездка и прибытие', kind: 'date' },
  { key: 'departureEvidence', label: 'Подтверждение фактического выезда', section: 'Поездка и прибытие', kind: 'text' },
  { key: 'plannedArrivalOn', label: 'Плановое прибытие', section: 'Поездка и прибытие', kind: 'date' },
  { key: 'receivingContact', label: 'Контакт встречающей стороны', section: 'Поездка и прибытие', kind: 'text' },
  { key: 'receivingPartyNotifiedOn', label: 'Встречающая сторона уведомлена', section: 'Поездка и прибытие', kind: 'date' },
  { key: 'receivingPartyEvidence', label: 'Подтверждение договорённости о встрече', section: 'Поездка и прибытие', kind: 'text' },
  { key: 'flightReference', label: 'Рейс / подтверждение билетов', section: 'Поездка и прибытие', kind: 'text' },
  { key: 'arrivalOn', label: 'Фактическая дата прибытия', section: 'Поездка и прибытие', kind: 'date' },
  { key: 'arrivalConfirmedBy', label: 'Кто подтвердил прибытие', section: 'Поездка и прибытие', kind: 'text' },
  { key: 'arrivalEvidence', label: 'Основание подтверждения прибытия', section: 'Поездка и прибытие', kind: 'text' },
  { key: 'medicalStatus', label: 'Медицинское обследование после прибытия', section: 'После прибытия', kind: 'enum', options: evidenceStatus },
  { key: 'medicalOn', label: 'Дата обследования', section: 'После прибытия', kind: 'date' },
  { key: 'medicalEvidence', label: 'Основание по обследованию', section: 'После прибытия', kind: 'text' },
  { key: 'registrationStatus', label: 'Регистрация в университете', section: 'После прибытия', kind: 'enum', options: evidenceStatus },
  { key: 'registrationOn', label: 'Дата регистрации', section: 'После прибытия', kind: 'date' },
  { key: 'registrationEvidence', label: 'Основание по регистрации', section: 'После прибытия', kind: 'text' },
  { key: 'studentPassStatus', label: 'Student Pass / разрешение на пребывание', section: 'После прибытия', kind: 'enum', options: evidenceStatus },
  { key: 'studentPassOn', label: 'Дата оформления разрешения', section: 'После прибытия', kind: 'date' },
  { key: 'studentPassEvidence', label: 'Основание по разрешению', section: 'После прибытия', kind: 'text' },
  { key: 'postArrivalInstructionsOn', label: 'Инструкции после прибытия переданы', section: 'После прибытия', kind: 'date' },
  { key: 'postArrivalInstructionsEvidence', label: 'Основание передачи инструкций', section: 'После прибытия', kind: 'text' },
];
export const ADMISSIONS_APPLICATION_FIELDS: readonly AdmissionsField[] = [
  { key: 'submissionPartner', label: 'Партнёр, который подаёт документы', section: 'Передача партнёру', kind: 'text' },
  { key: 'partnerContact', label: 'Контакт партнёра', section: 'Передача партнёру', kind: 'text' },
  { key: 'receivingRole', label: 'Роль получателя документов', section: 'Передача партнёру', kind: 'text' },
  { key: 'packageReference', label: 'Ссылка на переданный пакет', section: 'Передача партнёру', kind: 'text' },
  { key: 'packageVersion', label: 'Версия пакета', section: 'Передача партнёру', kind: 'text' },
  { key: 'partnerReplyDueOn', label: 'Ожидаемый ответ партнёра', section: 'Передача партнёру', kind: 'date' },
  { key: 'lastContactOn', label: 'Последний контакт с партнёром', section: 'Передача партнёру', kind: 'date' },
  { key: 'partnerSentOn', label: 'Документы переданы партнёру', section: 'Передача партнёру', kind: 'date' },
  { key: 'partnerReceivedOn', label: 'Партнёр подтвердил получение', section: 'Передача партнёру', kind: 'date' },
  { key: 'partnerReceiptEvidence', label: 'Подтверждение получения партнёром', section: 'Передача партнёру', kind: 'text' },
  { key: 'universitySubmittedOn', label: 'Фактическая дата подачи в университет', section: 'Подача', kind: 'date' },
  { key: 'universitySubmissionReference', label: 'Номер / ссылка подачи', section: 'Подача', kind: 'text' },
  { key: 'universitySubmissionEvidence', label: 'Основание фактической подачи', section: 'Подача', kind: 'text' },
  { key: 'correctionRequest', label: 'Что нужно исправить', section: 'Исправления', kind: 'text' },
  { key: 'correctionDeadline', label: 'Срок исправления', section: 'Исправления', kind: 'date' },
  { key: 'correctionResolvedOn', label: 'Исправление завершено', section: 'Исправления', kind: 'date' },
  { key: 'decisionType', label: 'Решение университета', section: 'Решение', kind: 'enum', options: ['pending', 'pre_admission', 'conditional', 'unconditional', 'rejected', 'enrolled'] },
  { key: 'decisionReference', label: 'Номер / ссылка решения', section: 'Решение', kind: 'text' },
  { key: 'decisionOn', label: 'Дата решения', section: 'Решение', kind: 'date' },
  { key: 'decisionEvidence', label: 'Основание решения', section: 'Решение', kind: 'text' },
  { key: 'offerConditions', label: 'Условия предложения', section: 'Решение', kind: 'text' },
  { key: 'offerDeadline', label: 'Срок ответа / выполнения условий', section: 'Решение', kind: 'date' },
  { key: 'conditionsFulfilledOn', label: 'Условия выполнены', section: 'Решение', kind: 'date' },
  { key: 'conditionsEvidence', label: 'Основание выполнения условий', section: 'Решение', kind: 'text' },
  { key: 'selectedOn', label: 'Предложение выбрано клиентом', section: 'Решение', kind: 'date' },
  { key: 'selectedBy', label: 'Кто подтвердил выбор предложения', section: 'Решение', kind: 'text' },
  { key: 'selectionEvidence', label: 'Основание выбора предложения', section: 'Решение', kind: 'text' },
  { key: 'documentsApplicability', label: 'Документы этой заявки', section: 'Документы заявки', kind: 'enum', options: applicability },
  { key: 'documentsSource', label: 'Основание списка документов', section: 'Документы заявки', kind: 'text' },
  { key: 'documentsCheckedOn', label: 'Список документов проверен', section: 'Документы заявки', kind: 'date' },
  { key: 'documentSlotIds', label: 'Обязательные документы этой заявки', section: 'Документы заявки', kind: 'text' },
  { key: 'documentExceptionSlotIds', label: 'Документы с согласованным исключением', section: 'Документы заявки', kind: 'text' },
  { key: 'documentsExceptionReason', label: 'Причина исключения', section: 'Документы заявки', kind: 'text' },
  { key: 'documentsExceptionEvidence', label: 'Основание исключения', section: 'Документы заявки', kind: 'text' },
];
export const ADMISSIONS_VISA_FIELDS: readonly AdmissionsField[] = [
  { key: 'passportExpiresOn', label: 'Паспорт действителен до', section: 'Паспорт и виза', kind: 'date' },
  { key: 'applicability', label: 'Требуется ли студенческая виза', section: 'Паспорт и виза', kind: 'enum', options: applicability },
  { key: 'applicabilityReason', label: 'Основание применимости визы', section: 'Паспорт и виза', kind: 'text' },
  { key: 'applicabilitySource', label: 'Официальный источник по визе', section: 'Паспорт и виза', kind: 'text' },
  { key: 'applicabilityCheckedOn', label: 'Дата проверки визовых требований', section: 'Паспорт и виза', kind: 'date' },
  { key: 'visaType', label: 'Тип визы', section: 'Паспорт и виза', kind: 'text' },
  { key: 'jwReference', label: 'Китай: основание / JW-документ', section: 'Паспорт и виза', kind: 'text' },
  { key: 'visaIssuedOn', label: 'Дата выдачи визы', section: 'Паспорт и виза', kind: 'date' },
  { key: 'visaExpiresOn', label: 'Виза действительна до', section: 'Паспорт и виза', kind: 'date' },
  { key: 'emgsReference', label: 'Малайзия: номер EMGS', section: 'EMGS / eVAL', kind: 'text' },
  { key: 'emgsStatus', label: 'Статус EMGS по фактической проверке', section: 'EMGS / eVAL', kind: 'text' },
  { key: 'eValStatus', label: 'Статус eVAL', section: 'EMGS / eVAL', kind: 'enum', options: ['pending', 'approved', 'rejected'] },
  { key: 'eValReference', label: 'Номер eVAL', section: 'EMGS / eVAL', kind: 'text' },
  { key: 'eValIssuedOn', label: 'eVAL выдан', section: 'EMGS / eVAL', kind: 'date' },
  { key: 'eValExpiresOn', label: 'eVAL действителен до', section: 'EMGS / eVAL', kind: 'date' },
  { key: 'eValEvidence', label: 'Основание eVAL', section: 'EMGS / eVAL', kind: 'text' },
  { key: 'entryVisaApplicability', label: 'SEV / eVISA: требуется ли', section: 'Въезд и MDAC', kind: 'enum', options: applicability },
  { key: 'entryVisaReason', label: 'Основание применимости SEV / eVISA', section: 'Въезд и MDAC', kind: 'text' },
  { key: 'entryVisaSource', label: 'Официальный источник SEV / eVISA', section: 'Въезд и MDAC', kind: 'text' },
  { key: 'entryVisaCheckedOn', label: 'Дата проверки SEV / eVISA', section: 'Въезд и MDAC', kind: 'date' },
  { key: 'entryVisaStatus', label: 'Статус SEV / eVISA', section: 'Въезд и MDAC', kind: 'enum', options: ['pending', 'approved', 'rejected'] },
  { key: 'entryVisaEvidence', label: 'Основание SEV / eVISA', section: 'Въезд и MDAC', kind: 'text' },
  { key: 'entryVisaExpiresOn', label: 'SEV / eVISA действительна до', section: 'Въезд и MDAC', kind: 'date' },
  { key: 'mdacApplicability', label: 'MDAC: требуется ли', section: 'Въезд и MDAC', kind: 'enum', options: applicability },
  { key: 'mdacReason', label: 'Основание применимости MDAC', section: 'Въезд и MDAC', kind: 'text' },
  { key: 'mdacSource', label: 'Официальный источник MDAC', section: 'Въезд и MDAC', kind: 'text' },
  { key: 'mdacCheckedOn', label: 'Дата проверки MDAC', section: 'Въезд и MDAC', kind: 'date' },
  { key: 'mdacSubmittedOn', label: 'MDAC подана', section: 'Въезд и MDAC', kind: 'date' },
  { key: 'mdacEvidence', label: 'Подтверждение MDAC', section: 'Въезд и MDAC', kind: 'text' },
];
/** Shared by read and edit views; hidden legacy facts remain in command snapshots. */
export function admissionsVisaFields(direction: AdmissionsDirection | null): readonly AdmissionsField[] {
  return ADMISSIONS_VISA_FIELDS.filter((field) => direction === 'MY'
    ? !['jwReference', 'visaIssuedOn', 'visaExpiresOn'].includes(field.key)
    : !['EMGS / eVAL', 'Въезд и MDAC'].includes(field.section));
}
export type AdmissionsFacts = Partial<Record<typeof ADMISSIONS_CASE_FIELDS[number]['key'], string>>;
export type AdmissionsApplicationDetails = Partial<Record<typeof ADMISSIONS_APPLICATION_FIELDS[number]['key'], string>>;
export type AdmissionsVisaDetails = Partial<Record<typeof ADMISSIONS_VISA_FIELDS[number]['key'], string>>;
export function validateAdmissionsFields(input: unknown, fields: readonly AdmissionsField[]): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Неверный формат данных маршрута');
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    const field = fields.find((item) => item.key === key);
    if (!field || typeof raw !== 'string' || raw.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)) throw new Error('Недопустимое поле маршрута');
    const value = raw.trim();
    if (!value) continue;
    if (field.kind === 'enum' && !field.options?.includes(value)) throw new Error(`Проверьте: ${field.label}`);
    if (field.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(`Проверьте дату: ${field.label}`);
    result[key] = value;
  }
  return result;
}
export interface AdmissionsPlaybook {
  id: string; direction: 'CN' | 'MY'; version: string; title: string; publishedAt: string;
  content: {
    stages: { key: AdmissionsStage; title: string; summary: string; checklist: string[]; exitCriteria: string[]; cautions: string[] }[];
    tasks: { key: string; stageKey: AdmissionsStage; title: string; priority: 'normal' | 'high'; studentVisible: false }[];
    messages: { id: string; stageKey: AdmissionsStage; title: string; audience: 'student' | 'referral' | 'partner' | 'university'; locale: 'ru' | 'en'; whenToUse: string; body: string; placeholders: { key: string; label: string }[]; sourceIds: string[] }[];
    sources: { id: string; title: string; kind: string; sourceVersion: string; sha256?: string; url?: string; reviewedOn: string; scope: string }[];
    limitations: string[];
  };
}
export interface AdmissionsWorkspace {
  case: { id: string; organizationId: string; direction: AdmissionsDirection | null; playbookVersionId: string | null; version: string; stage: string; outcome: AdmissionsOutcome | null; state: 'pending' | 'active' | 'closed'; primaryApplicationId: string | null; routeApprovalStatus: 'draft' | 'approved' | 'rework'; nextAction: string | null; nextActionDueOn: string | null; facts: AdmissionsFacts };
  playbook: AdmissionsPlaybook | null;
  applications: { id: string; institutionName: string; programName: string; status: string; version: string; details: AdmissionsApplicationDetails }[];
  visa: { id: string; status: string; version: string; details: AdmissionsVisaDetails } | null;
  handoff: unknown;
  gates: { stage: AdmissionsStage; ready: boolean; blockers: string[] }[];
  events: { id: string; kind: string; stage: string; outcome: AdmissionsOutcome | null; reason: string; createdAt: string; effectiveOn: string | null }[];
}
export interface AdmissionsMutationReceipt { caseId: string; version: string; stage?: string; outcome?: AdmissionsOutcome; applicationId?: string; visaCaseId?: string; requestId: string; changedAt: string }
export interface AdmissionsSummary {
  periodFrom: string | null; periodTo: string | null;
  stock: { direction: AdmissionsDirection | 'unknown'; active: number; overdue: number; awaiting_ack: number; awaiting_partner: number; submitted: number; decisions: number; visas: number; arrivals: number; cancelled: number; arrived: number }[];
  periodArrivals: { direction: AdmissionsDirection | 'unknown'; count: number }[];
}
