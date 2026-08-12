import type {
  ApplicationStatus,
  ClientStage,
  CurrencyCode,
  DateTimeString,
  DocumentStatus,
  IsoDateString,
  PaymentStatus,
  TaskPriority,
  TaskStatus,
  VisaStatus,
} from "../domain";

/**
 * The accepted portal used numeric SQLite identifiers before the Platform
 * cutover. Platform snapshots always use UUID strings, while this union keeps
 * the legacy, non-portal read model type-safe until it is retired separately.
 */
export type StudentPortalEntityId = string | number;

export const STUDENT_PORTAL_SECTIONS = [
  "overview",
  "stage",
  "contacts",
  "tasks",
  "updates",
  "applications",
  "documents",
  "visa",
  "payments",
] as const;

export type StudentPortalSection = (typeof STUDENT_PORTAL_SECTIONS)[number];

export type StudentPortalStageItem = {
  readonly stage: ClientStage;
  readonly labelKey: `stage.${ClientStage}`;
  readonly state: "complete" | "current" | "locked";
};

export type StudentPortalUpdate = {
  readonly id: StudentPortalEntityId;
  readonly message: string;
  readonly authorName: string | null;
  readonly createdAt: DateTimeString;
  readonly isRead: boolean;
};

/**
 * A durable, student-owned in-app notification. Source record, provider,
 * reviewer, topic and document-version identifiers are intentionally absent.
 */
export type StudentPortalDocumentReviewNotification = {
  readonly id: string;
  readonly category: "document.review";
  readonly decision: "correction_required" | "rejected";
  readonly requirementKey: string;
  readonly requirementLabel: string;
  readonly reason: string;
  readonly createdAt: DateTimeString;
  readonly readAt: DateTimeString | null;
  readonly isRead: boolean;
};

type StudentPortalNotificationV2Base = {
  readonly id: string;
  readonly subjectLabel: string;
  readonly detail: string;
  readonly createdAt: DateTimeString;
  readonly readAt: DateTimeString | null;
  readonly isRead: boolean;
};

/**
 * The P6C browser-safe union. It deliberately has no source, case,
 * organization, membership, amount, provider, task or payment identifiers.
 */
export type StudentPortalNotificationV2 =
  | (StudentPortalNotificationV2Base & {
      readonly category: "document.review";
      readonly eventCode: "correction_required" | "rejected";
      readonly dueAt: null;
    })
  | (StudentPortalNotificationV2Base & {
      readonly category: "task.overdue" | "payment.overdue";
      readonly eventCode: "overdue";
      readonly dueAt: DateTimeString;
    });

export type StudentPortalNotification =
  | StudentPortalDocumentReviewNotification
  | StudentPortalNotificationV2;

export type StudentPortalContact = {
  readonly id: StudentPortalEntityId;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly role: string;
};

export type StudentPortalNextAction = {
  readonly labelKey: string;
  readonly detail: string;
  readonly dueDate: string | null;
  readonly severity: "normal" | "warning" | "urgent";
};

export type StudentPortalApplication = {
  readonly id: StudentPortalEntityId;
  readonly university: string;
  readonly country: string | null;
  readonly program: string | null;
  readonly degree: string | null;
  readonly deadline: IsoDateString | null;
  readonly status: ApplicationStatus;
  readonly notes: string | null;
};

export type StudentPortalDocument = {
  readonly id: StudentPortalEntityId;
  readonly name: string;
  readonly status: DocumentStatus;
  readonly comment: string | null;
  readonly updatedAt: DateTimeString | null;
};

export type StudentPortalVisaCase = {
  readonly id: StudentPortalEntityId;
  readonly country: string;
  readonly status: VisaStatus;
  readonly appointmentAt: DateTimeString | null;
  readonly notes: string | null;
};

export type StudentPortalPayment = {
  readonly id: StudentPortalEntityId;
  readonly title: string;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly dueDate: IsoDateString | null;
  readonly paidAt: IsoDateString | null;
  readonly status: PaymentStatus;
};

export type StudentPortalTask = {
  readonly id: StudentPortalEntityId;
  readonly title: string;
  readonly description: string | null;
  readonly dueDate: IsoDateString | null;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly assigneeName: string | null;
};

/**
 * Student-visible, data-minimized profile fields. Internal evidence references,
 * policy/checklist version identifiers and workflow-only metadata are
 * validated by the repository but deliberately not exposed to the page.
 */
export type StudentPortalProfileSummary = {
  readonly revision: number;
  readonly preferredDisplayName: string | null;
  readonly legalDisplayName: string | null;
  readonly communicationLanguage: PlatformStudentProfileCommunicationLanguage | null;
  readonly dateOfBirth: IsoDateString | null;
  readonly citizenshipCountry: string | null;
  readonly residencyCountry: string | null;
  readonly currentEducationSummary: string | null;
  readonly academicSummary: string | null;
  readonly languageSummary: string | null;
  readonly budgetBand: string | null;
  readonly decisionParticipantLabels: readonly string[];
  readonly consentStatus: string;
  readonly nextStep: string | null;
  readonly programDirection: string | null;
  readonly intake: string | null;
  readonly requiredFields: readonly string[];
};

export type StudentPortalSnapshot = {
  readonly student: {
    readonly id: StudentPortalEntityId;
    readonly name: string;
    readonly email: string | null;
    readonly phone: string | null;
  };
  readonly client: {
    readonly id: StudentPortalEntityId;
    readonly stage: ClientStage;
    readonly targetCountry: string | null;
    readonly targetDegree: string | null;
    readonly managerId: StudentPortalEntityId | null;
    readonly curatorId: StudentPortalEntityId | null;
  };
  readonly profile?: StudentPortalProfileSummary;
  readonly visibleSections: readonly StudentPortalSection[];
  readonly stageTimeline: readonly StudentPortalStageItem[];
  readonly progressPercent: number;
  readonly nextAction: StudentPortalNextAction | null;
  readonly manager: StudentPortalContact | null;
  readonly curator: StudentPortalContact | null;
  readonly notifications?: readonly StudentPortalNotification[];
  readonly updates: readonly StudentPortalUpdate[];
  readonly applications: readonly StudentPortalApplication[];
  readonly documents: readonly StudentPortalDocument[];
  readonly visa: StudentPortalVisaCase | null;
  readonly payments: readonly StudentPortalPayment[];
  readonly tasks: readonly StudentPortalTask[];
  readonly generatedAt: DateTimeString;
};

export type StudentPortalResult =
  | {
      readonly status: "ready";
      readonly snapshot: StudentPortalSnapshot;
    }
  | {
      readonly status: "not_found";
      readonly userId: StudentPortalEntityId;
    }
  | {
      readonly status: "forbidden";
      readonly userId: StudentPortalEntityId;
      readonly reason: "not_client" | "session_missing";
    };

export type StudentPortalContract = {
  readonly getSnapshotForUser: (
    userId: StudentPortalEntityId,
  ) => Promise<StudentPortalResult>;
  readonly markUpdateRead: (
    userId: StudentPortalEntityId,
    updateId: StudentPortalEntityId,
  ) => Promise<StudentPortalResult>;
};
import type { PlatformStudentProfileCommunicationLanguage } from "../platform-student-profile";
