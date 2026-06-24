import type {
  ClientProfile,
  ClientStage,
  DateTimeString,
  EntityId,
  Payment,
  StudentDocument,
  Task,
  UniversityApplication,
  UserIdentity,
  VisaCase,
} from "../domain";

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
  readonly id: EntityId;
  readonly message: string;
  readonly authorName: string | null;
  readonly createdAt: DateTimeString;
  readonly isRead: boolean;
};

export type StudentPortalContact = Pick<UserIdentity, "id" | "name" | "email" | "phone"> & {
  readonly role: string;
};

export type StudentPortalNextAction = {
  readonly labelKey: string;
  readonly detail: string;
  readonly dueDate: string | null;
  readonly severity: "normal" | "warning" | "urgent";
};

export type StudentPortalApplication = Pick<
  UniversityApplication,
  "id" | "university" | "country" | "program" | "degree" | "deadline" | "status" | "notes"
>;

export type StudentPortalDocument = Pick<StudentDocument, "id" | "name" | "status" | "comment" | "updatedAt">;

export type StudentPortalVisaCase = Pick<VisaCase, "id" | "country" | "status" | "appointmentAt" | "notes">;

export type StudentPortalPayment = Pick<Payment, "id" | "title" | "amount" | "currency" | "dueDate" | "paidAt" | "status">;

export type StudentPortalTask = Pick<
  Task,
  "id" | "title" | "description" | "dueDate" | "status" | "priority"
> & {
  readonly assigneeName: string | null;
};

export type StudentPortalSnapshot = {
  readonly student: Pick<UserIdentity, "id" | "name" | "email" | "phone">;
  readonly client: Pick<
    ClientProfile,
    "id" | "stage" | "targetCountry" | "targetDegree" | "managerId" | "curatorId"
  >;
  readonly visibleSections: readonly StudentPortalSection[];
  readonly stageTimeline: readonly StudentPortalStageItem[];
  readonly progressPercent: number;
  readonly nextAction: StudentPortalNextAction | null;
  readonly manager: StudentPortalContact | null;
  readonly curator: StudentPortalContact | null;
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
      readonly userId: EntityId;
    }
  | {
      readonly status: "forbidden";
      readonly userId: EntityId;
      readonly reason: "not_client" | "session_missing";
    };

export type StudentPortalContract = {
  readonly getSnapshotForUser: (userId: EntityId) => Promise<StudentPortalResult>;
  readonly markUpdateRead: (userId: EntityId, updateId: EntityId) => Promise<StudentPortalResult>;
};
