import type { DocumentStatus } from "@/lib/domain";
import type { Locale } from "@/lib/i18n-data";

type StatusGuidance = {
  title: string;
  description: string;
  nextStep: string;
};

export type DocumentExperienceCopy = {
  queueBoundaryTitle: string;
  queueBoundaryDescription: string;
  ownerNextStep: string;
  openReview: string;
  reviewActionShort: string;
  assignedOwner: string;
  noOwner: string;
  filteredEmptyTitle: string;
  filteredEmptyDescription: string;
  emptyTitle: string;
  emptyDescription: string;
  clearFilter: string;
  workflowTitle: string;
  workflowDescription: string;
  workflowSteps: {
    requirement: string;
    received: string;
    review: string;
    decision: string;
    nextVersion: string;
  };
  correctionGuidance: StatusGuidance;
  statusGuidance: Record<DocumentStatus, StatusGuidance>;
  currentStep: string;
  completedStep: string;
  blockedStep: string;
  fileWorkspace: string;
  noFileTitle: string;
  noFileDescription: string;
  noFileTechnicalNote: string;
  openFile: string;
  downloadFile: string;
  uploadNewVersion: string;
  resubmitVersion: string;
  storageUnknownLimits: string;
  decisionWorkspace: string;
  decisionDescription: string;
  approve: string;
  approveHint: string;
  correction: string;
  reject: string;
  decisionReason: string;
  decisionReasonPlaceholder: string;
  decisionReasonHelp: string;
  sendToReview: string;
  sendToReviewHint: string;
  reopenReview: string;
  reopenReasonPlaceholder: string;
  reopenHint: string;
  saving: string;
  mutationBoundary: string;
  noDecisionTitle: string;
  noDecisionDescription: string;
  ownerAndNextStep: string;
  ownerLabel: string;
  nextStepLabel: string;
  blockedReasonLabel: string;
  storageBlockReason: string;
  currentRecordHistory: string;
  historyUnavailableTitle: string;
  historyUnavailableDescription: string;
  currentRecord: string;
  currentRecordNotVersion: string;
  recordedStatus: string;
  recordedComment: string;
  updatedAt: string;
  correctionRequested: string;
  initialRequirement: string;
  updateMessages: Record<"approved" | "required" | "rejected" | "review", string>;
  errorMessages: Record<"comment_required" | "comment_too_long" | "invalid_transition", string>;
  loading: string;
  loadingHint: string;
  errorTitle: string;
  errorDescription: string;
  tryAgain: string;
  backToQueue: string;
};

const COPY: Record<Locale, DocumentExperienceCopy> = {
  ru: {
    queueBoundaryTitle: "Статусы работают, файлы пока не подключены",
    queueBoundaryDescription:
      "Решения специалиста и комментарии сохраняются в EVO CRM. Сам файл, безопасная загрузка, версии и отдельный журнал событий требуют backend-хранилища.",
    ownerNextStep: "Ответственный и следующий шаг",
    openReview: "Открыть проверку",
    reviewActionShort: "Проверить",
    assignedOwner: "Ответственный",
    noOwner: "Не назначен",
    filteredEmptyTitle: "В этом статусе документов нет",
    filteredEmptyDescription: "Сбросьте фильтр, чтобы вернуться ко всей очереди.",
    emptyTitle: "Очередь документов пуста",
    emptyDescription: "Документ появится здесь после добавления требования в Student 360.",
    clearFilter: "Показать всю очередь",
    workflowTitle: "Путь документа",
    workflowDescription:
      "Путь показывает реальный статус карточки и честно останавливается там, где нужен неподключённый файловый backend.",
    workflowSteps: {
      requirement: "Требование",
      received: "Отметка о получении",
      review: "Проверка",
      decision: "Решение",
      nextVersion: "Новая версия",
    },
    correctionGuidance: {
      title: "Запрошена корректировка",
      description: "Причина сохранена в карточке. Новую версию нельзя загрузить в этой CRM, пока не подключено файловое хранилище.",
      nextStep: "Передайте комментарий студенту через утверждённый канал и согласуйте безопасную передачу новой версии.",
    },
    statusGuidance: {
      required: {
        title: "Документ требуется",
        description: "В карточке есть требование, но файла в EVO CRM нет.",
        nextStep: "Согласуйте со студентом безопасный канал передачи. Встроенная загрузка пока недоступна.",
      },
      uploaded: {
        title: "Есть отметка «Загружен»",
        description: "Статус сохранён, но файл и источник загрузки в этой базе не записаны и не могут быть проверены.",
        nextStep: "Подтвердите файл в утверждённом внешнем канале, затем передайте карточку на проверку.",
      },
      review: {
        title: "Готово к решению специалиста",
        description: "Можно сохранить принятие, запрос корректировки или отклонение. Предпросмотр файла недоступен.",
        nextStep: "Сверьте документ в утверждённом канале и зафиксируйте решение с понятной причиной.",
      },
      approved: {
        title: "Карточка принята",
        description: "Решение сохранено в EVO CRM. Это не подтверждает наличие или сохранность самого файла.",
        nextStep: "Дополнительное действие не требуется, если решение не нужно пересмотреть.",
      },
      rejected: {
        title: "Документ отклонён",
        description: "Причина сохранена в карточке. Новую версию нельзя принять через эту CRM без файлового backend.",
        nextStep: "Объясните причину студенту и согласуйте безопасную передачу исправленного файла.",
      },
    },
    currentStep: "Текущий этап",
    completedStep: "Пройдено",
    blockedStep: "Заблокировано",
    fileWorkspace: "Файл и версии",
    noFileTitle: "Файл не прикреплён к этой записи",
    noFileDescription:
      "В таблице документов нет идентификатора файла или адреса хранилища, поэтому предпросмотр, скачивание и проверка содержимого недоступны.",
    noFileTechnicalNote: "Карточка содержит только название, статус, комментарий и дату обновления.",
    openFile: "Открыть файл",
    downloadFile: "Скачать",
    uploadNewVersion: "Загрузить новую версию",
    resubmitVersion: "Отправить версию на проверку",
    storageUnknownLimits: "Форматы, лимит размера и антивирусная проверка пока не определены backend-контрактом.",
    decisionWorkspace: "Решение специалиста",
    decisionDescription:
      "Действия ниже меняют только статус и комментарий карточки. Содержимое файла нужно проверить в утверждённом безопасном канале.",
    approve: "Принять документ",
    approveHint: "Сохранит статус «Принят» и очистит текущую причину доработки.",
    correction: "На доработку",
    reject: "Отклонить",
    decisionReason: "Причина для студента",
    decisionReasonPlaceholder: "Что нужно исправить и по какому критерию проверить новую версию?",
    decisionReasonHelp: "Причина обязательна для доработки и отклонения. Максимум 1000 символов.",
    sendToReview: "Передать на проверку",
    sendToReviewHint:
      "Используйте только после того, как файл подтверждён в утверждённом канале. Это действие не загружает файл.",
    reopenReview: "Пересмотреть решение",
    reopenReasonPlaceholder: "Почему принятое решение нужно пересмотреть?",
    reopenHint: "Вернёт только карточку в статус «На проверке»; файл не изменится.",
    saving: "Сохраняем…",
    mutationBoundary: "Изменение статуса не отправляет студенту автоматическое уведомление.",
    noDecisionTitle: "Решение сейчас недоступно",
    noDecisionDescription:
      "Сначала нужен файл или новая версия. Встроенная загрузка не подключена, поэтому переход дальше заблокирован.",
    ownerAndNextStep: "Ответственный, причина блокировки и следующий шаг",
    ownerLabel: "Ответственный",
    nextStepLabel: "Следующий шаг",
    blockedReasonLabel: "Причина блокировки",
    storageBlockReason: "Нет безопасного файлового хранилища, версии, журнала загрузок и серверной проверки файла.",
    currentRecordHistory: "Текущая запись и история",
    historyUnavailableTitle: "Отдельная история событий не хранится",
    historyUnavailableDescription:
      "Ниже показано только текущее состояние записи. Его нельзя считать версией файла или полным аудит-журналом.",
    currentRecord: "Текущее состояние карточки",
    currentRecordNotVersion: "Не является версией файла",
    recordedStatus: "Сохранённый статус",
    recordedComment: "Текущий комментарий",
    updatedAt: "Последнее обновление записи",
    correctionRequested: "Запрос корректировки",
    initialRequirement: "Первичное требование",
    updateMessages: {
      approved: "Решение «Принят» сохранено в карточке.",
      required: "Запрос корректировки и причина сохранены в карточке.",
      rejected: "Отклонение и причина сохранены в карточке.",
      review: "Карточка возвращена на проверку.",
    },
    errorMessages: {
      comment_required: "Укажите причину: она обязательна для этого решения.",
      comment_too_long: "Причина слишком длинная. Оставьте не более 1000 символов.",
      invalid_transition: "Этот переход недоступен из текущего статуса. Обновите страницу и проверьте состояние карточки.",
    },
    loading: "Загружаем документы",
    loadingHint: "Получаем очередь и текущее состояние карточек из EVO CRM.",
    errorTitle: "Не удалось загрузить документы",
    errorDescription: "Повторите запрос. Если ошибка сохранится, сообщите ответственному сотруднику и не меняйте статус вслепую.",
    tryAgain: "Повторить",
    backToQueue: "Вернуться в очередь",
  },
  ky: {
    queueBoundaryTitle: "Статустар иштейт, файлдар азырынча туташкан эмес",
    queueBoundaryDescription:
      "Адистин чечими жана комментарийи EVO CRMде сакталат. Файлдын өзү, коопсуз жүктөө, версиялар жана өзүнчө окуялар журналы backend сактагычын талап кылат.",
    ownerNextStep: "Жооптуу жана кийинки кадам",
    openReview: "Текшерүүнү ачуу",
    reviewActionShort: "Текшерүү",
    assignedOwner: "Жооптуу",
    noOwner: "Дайындалган эмес",
    filteredEmptyTitle: "Бул статуста документ жок",
    filteredEmptyDescription: "Бардык кезекке кайтуу үчүн чыпканы тазалаңыз.",
    emptyTitle: "Документтер кезеги бош",
    emptyDescription: "Student 360 ичинде талап кошулганда документ бул жерде көрүнөт.",
    clearFilter: "Бардык кезекти көрсөтүү",
    workflowTitle: "Документтин жолу",
    workflowDescription:
      "Жол карточканын чыныгы статусун көрсөтөт жана файлдык backend керек болгон жерде ачык токтойт.",
    workflowSteps: {
      requirement: "Талап",
      received: "Алынды деген белги",
      review: "Текшерүү",
      decision: "Чечим",
      nextVersion: "Жаңы версия",
    },
    correctionGuidance: {
      title: "Түзөтүү суралды",
      description: "Себеп карточкада сакталды. Файл сактагычы туташмайынча жаңы версияны бул CRMге жүктөө мүмкүн эмес.",
      nextStep: "Комментарийди студентке бекитилген канал аркылуу жеткирип, жаңы версияны коопсуз берүү жолун макулдашыңыз.",
    },
    statusGuidance: {
      required: {
        title: "Документ талап кылынат",
        description: "Карточкада талап бар, бирок EVO CRMде файл жок.",
        nextStep: "Студент менен коопсуз берүү каналын макулдашыңыз. Ички жүктөө азырынча жеткиликсиз.",
      },
      uploaded: {
        title: "«Жүктөлдү» деген белги бар",
        description: "Статус сакталган, бирок файл жана жүктөө булагы бул базада жазылган эмес жана текшерилбейт.",
        nextStep: "Файлды бекитилген тышкы каналда ырастап, андан кийин карточканы текшерүүгө өткөрүңүз.",
      },
      review: {
        title: "Адистин чечимине даяр",
        description: "Кабыл алуу, түзөтүү суроо же четке кагуу чечимин сактоого болот. Файлды алдын ала көрүү жеткиликсиз.",
        nextStep: "Документти бекитилген каналда салыштырып, түшүнүктүү себеп менен чечимди жазыңыз.",
      },
      approved: {
        title: "Карточка кабыл алынды",
        description: "Чечим EVO CRMде сакталды. Бул файлдын бар экенин же коопсуз сакталганын ырастабайт.",
        nextStep: "Чечимди кайра кароо талап кылынбаса, кошумча аракет керек эмес.",
      },
      rejected: {
        title: "Документ четке кагылды",
        description: "Себеп карточкада сакталды. Файлдык backend жок болгондуктан жаңы версияны бул CRM аркылуу кабыл алуу мүмкүн эмес.",
        nextStep: "Себепти студентке түшүндүрүп, оңдолгон файлды коопсуз берүү жолун макулдашыңыз.",
      },
    },
    currentStep: "Учурдагы этап",
    completedStep: "Бүткөн",
    blockedStep: "Бөгөттөлгөн",
    fileWorkspace: "Файл жана версиялар",
    noFileTitle: "Бул жазууга файл тиркелген эмес",
    noFileDescription:
      "Документтер таблицасында файлдын идентификатору же сактагыч дареги жок, ошондуктан көрүү, жүктөп алуу жана мазмунду текшерүү жеткиликсиз.",
    noFileTechnicalNote: "Карточкада аталыш, статус, комментарий жана жаңыртуу күнү гана бар.",
    openFile: "Файлды ачуу",
    downloadFile: "Жүктөп алуу",
    uploadNewVersion: "Жаңы версияны жүктөө",
    resubmitVersion: "Версияны текшерүүгө жөнөтүү",
    storageUnknownLimits: "Форматтар, көлөм чеги жана антивирус текшерүүсү backend келишиминде азырынча аныкталган эмес.",
    decisionWorkspace: "Адистин чечими",
    decisionDescription:
      "Төмөнкү аракеттер карточканын статусун жана комментарийин гана өзгөртөт. Файлдын мазмунун бекитилген коопсуз каналда текшерүү керек.",
    approve: "Документти кабыл алуу",
    approveHint: "«Кабыл алынды» статусун сактап, учурдагы түзөтүү себебин тазалайт.",
    correction: "Түзөтүүгө кайтаруу",
    reject: "Четке кагуу",
    decisionReason: "Студент үчүн себеп",
    decisionReasonPlaceholder: "Эмнени оңдоп, жаңы версияны кайсы критерий менен текшерүү керек?",
    decisionReasonHelp: "Түзөтүү жана четке кагуу үчүн себеп милдеттүү. Эң көп 1000 белги.",
    sendToReview: "Текшерүүгө өткөрүү",
    sendToReviewHint:
      "Файл бекитилген каналда ырасталгандан кийин гана колдонуңуз. Бул аракет файл жүктөбөйт.",
    reopenReview: "Чечимди кайра кароо",
    reopenReasonPlaceholder: "Эмне үчүн кабыл алынган чечимди кайра кароо керек?",
    reopenHint: "Карточканы гана «Текшерүүдө» статусуна кайтарат; файл өзгөрбөйт.",
    saving: "Сакталууда…",
    mutationBoundary: "Статусту өзгөртүү студентке автоматтык билдирүү жөнөтпөйт.",
    noDecisionTitle: "Азыр чечим чыгаруу мүмкүн эмес",
    noDecisionDescription:
      "Адегенде файл же жаңы версия керек. Ички жүктөө туташкан эмес, ошондуктан кийинки өтүү бөгөттөлгөн.",
    ownerAndNextStep: "Жооптуу, бөгөттүн себеби жана кийинки кадам",
    ownerLabel: "Жооптуу",
    nextStepLabel: "Кийинки кадам",
    blockedReasonLabel: "Бөгөттүн себеби",
    storageBlockReason: "Коопсуз файл сактагычы, версиялар, жүктөө журналы жана сервердик файл текшерүүсү жок.",
    currentRecordHistory: "Учурдагы жазуу жана тарых",
    historyUnavailableTitle: "Өзүнчө окуялар тарыхы сакталбайт",
    historyUnavailableDescription:
      "Төмөндө жазуунун учурдагы абалы гана көрсөтүлөт. Муну файл версиясы же толук аудит журналы деп эсептөөгө болбойт.",
    currentRecord: "Карточканын учурдагы абалы",
    currentRecordNotVersion: "Файлдын версиясы эмес",
    recordedStatus: "Сакталган статус",
    recordedComment: "Учурдагы комментарий",
    updatedAt: "Жазуунун акыркы жаңыртылышы",
    correctionRequested: "Түзөтүү суроосу",
    initialRequirement: "Баштапкы талап",
    updateMessages: {
      approved: "«Кабыл алынды» чечими карточкада сакталды.",
      required: "Түзөтүү суроосу жана себеби карточкада сакталды.",
      rejected: "Четке кагуу жана себеби карточкада сакталды.",
      review: "Карточка текшерүүгө кайтарылды.",
    },
    errorMessages: {
      comment_required: "Себепти жазыңыз: бул чечим үчүн ал милдеттүү.",
      comment_too_long: "Себеп өтө узун. 1000 белгиден ашырбаңыз.",
      invalid_transition: "Бул өтүү учурдагы статустан жеткиликсиз. Баракты жаңыртып, карточканын абалын текшериңиз.",
    },
    loading: "Документтер жүктөлүүдө",
    loadingHint: "EVO CRMден кезекти жана карточкалардын учурдагы абалын алып жатабыз.",
    errorTitle: "Документтерди жүктөө мүмкүн болгон жок",
    errorDescription: "Кайра аракет кылыңыз. Ката калса, жооптуу кызматкерге билдирип, статусту божомол менен өзгөртпөңүз.",
    tryAgain: "Кайра аракет кылуу",
    backToQueue: "Кезекке кайтуу",
  },
  en: {
    queueBoundaryTitle: "Statuses work; files are not connected yet",
    queueBoundaryDescription:
      "Specialist decisions and comments persist in EVO CRM. The file itself, secure upload, versions, and a separate event log require backend storage.",
    ownerNextStep: "Owner and next step",
    openReview: "Open review",
    reviewActionShort: "Review",
    assignedOwner: "Owner",
    noOwner: "Not assigned",
    filteredEmptyTitle: "No documents have this status",
    filteredEmptyDescription: "Clear the filter to return to the full queue.",
    emptyTitle: "The document queue is empty",
    emptyDescription: "A document will appear here after a requirement is added in Student 360.",
    clearFilter: "Show full queue",
    workflowTitle: "Document journey",
    workflowDescription:
      "The journey shows the real record status and stops honestly where the missing file backend is required.",
    workflowSteps: {
      requirement: "Requirement",
      received: "Received flag",
      review: "Review",
      decision: "Decision",
      nextVersion: "New version",
    },
    correctionGuidance: {
      title: "Correction requested",
      description: "The reason is stored on the record. A new version cannot be uploaded in this CRM until file storage is connected.",
      nextStep: "Share the comment through an approved channel and agree on a secure way to receive the new version.",
    },
    statusGuidance: {
      required: {
        title: "Document required",
        description: "The requirement exists, but EVO CRM has no file.",
        nextStep: "Agree on a secure transfer channel with the student. Built-in upload is unavailable.",
      },
      uploaded: {
        title: "Record is marked “Uploaded”",
        description: "The status is stored, but this database has no file or upload source to verify.",
        nextStep: "Confirm the file in an approved external channel, then move the record to review.",
      },
      review: {
        title: "Ready for a specialist decision",
        description: "You can persist approval, a correction request, or rejection. File preview is unavailable.",
        nextStep: "Check the document in the approved channel and record a clear decision reason.",
      },
      approved: {
        title: "Record approved",
        description: "The decision is stored in EVO CRM. It does not prove that the file exists or is safely retained.",
        nextStep: "No further document action is needed unless the decision must be reconsidered.",
      },
      rejected: {
        title: "Document rejected",
        description: "The reason is stored on the record. This CRM cannot receive a new version without a file backend.",
        nextStep: "Explain the reason to the student and agree on secure delivery of a corrected file.",
      },
    },
    currentStep: "Current step",
    completedStep: "Completed",
    blockedStep: "Blocked",
    fileWorkspace: "File and versions",
    noFileTitle: "No file is attached to this record",
    noFileDescription:
      "The documents table has no file identifier or storage address, so preview, download, and content verification are unavailable.",
    noFileTechnicalNote: "The record contains only a name, status, comment, and update timestamp.",
    openFile: "Open file",
    downloadFile: "Download",
    uploadNewVersion: "Upload new version",
    resubmitVersion: "Submit version for review",
    storageUnknownLimits: "Formats, size limits, and malware scanning are not defined by a backend contract yet.",
    decisionWorkspace: "Specialist decision",
    decisionDescription:
      "The actions below change only the record status and comment. Check the file content in an approved secure channel.",
    approve: "Approve document",
    approveHint: "Stores “Approved” and clears the current correction reason.",
    correction: "Request correction",
    reject: "Reject",
    decisionReason: "Reason for the student",
    decisionReasonPlaceholder: "What must change, and how should the new version be checked?",
    decisionReasonHelp: "A reason is required for correction and rejection. Maximum 1,000 characters.",
    sendToReview: "Move to review",
    sendToReviewHint:
      "Use only after confirming the file through an approved channel. This action does not upload a file.",
    reopenReview: "Reconsider decision",
    reopenReasonPlaceholder: "Why does the approved decision need review?",
    reopenHint: "Moves only the record back to “In review”; it does not change a file.",
    saving: "Saving…",
    mutationBoundary: "Changing status does not automatically notify the student.",
    noDecisionTitle: "A decision is not available now",
    noDecisionDescription:
      "A file or new version is needed first. Built-in upload is not connected, so progress is blocked.",
    ownerAndNextStep: "Owner, blocker, and next step",
    ownerLabel: "Owner",
    nextStepLabel: "Next step",
    blockedReasonLabel: "Blocked because",
    storageBlockReason: "There is no secure file store, version model, upload event log, or server-side file validation.",
    currentRecordHistory: "Current record and history",
    historyUnavailableTitle: "A separate event history is not stored",
    historyUnavailableDescription:
      "Only the current record is shown below. It is not a file version or a complete audit log.",
    currentRecord: "Current record state",
    currentRecordNotVersion: "Not a file version",
    recordedStatus: "Stored status",
    recordedComment: "Current comment",
    updatedAt: "Record last updated",
    correctionRequested: "Correction request",
    initialRequirement: "Initial requirement",
    updateMessages: {
      approved: "The approved decision was saved to the record.",
      required: "The correction request and reason were saved to the record.",
      rejected: "The rejection and reason were saved to the record.",
      review: "The record was returned to review.",
    },
    errorMessages: {
      comment_required: "Enter a reason; it is required for this decision.",
      comment_too_long: "The reason is too long. Keep it to 1,000 characters.",
      invalid_transition: "This transition is unavailable from the current status. Refresh and check the record state.",
    },
    loading: "Loading documents",
    loadingHint: "Fetching the queue and current record state from EVO CRM.",
    errorTitle: "Documents could not be loaded",
    errorDescription: "Try again. If the error persists, tell the responsible staff member and do not change status blindly.",
    tryAgain: "Try again",
    backToQueue: "Back to queue",
  },
};

export function getDocumentExperienceCopy(locale: Locale): DocumentExperienceCopy {
  return COPY[locale] ?? COPY.ru;
}

export function getDocumentGuidance(
  status: DocumentStatus,
  hasComment: boolean,
  copy: DocumentExperienceCopy,
): StatusGuidance {
  if (status === "required" && hasComment) return copy.correctionGuidance;
  return copy.statusGuidance[status];
}
