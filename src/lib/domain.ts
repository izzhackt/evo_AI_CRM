import type { LeadStatus } from "./lead-stages";
import {
  STAFF_ROLES,
  type Role,
  type StaffRole,
} from "./roles";
export {
  ROLES,
  STAFF_ROLES,
  isRole,
  type Role,
  type StaffRole,
} from "./roles";
export {
  EVO_AMO_PIPELINE_ID,
  LEAD_ACTIVE_STATUSES,
  LEAD_STAGE_DEFINITIONS,
  LEAD_STATUSES,
  LEAD_TERMINAL_STATUSES,
  isActiveLeadStatus,
} from "./lead-stages";
export type { LeadStatus } from "./lead-stages";

export const STAFF_ROUTE_VALUES = [
  "/dashboard",
  "/sales",
  "/clients",
  "/applications",
  "/documents",
  "/visa",
  "/whatsapp",
  "/calls",
  "/notifications",
  "/tasks",
  "/chat",
  "/reports",
  "/finance",
  "/settings",
] as const;

export type StaffRoute = (typeof STAFF_ROUTE_VALUES)[number];
export type PublicRoute = "/" | "/login";
export type ClientRoute = "/portal";
export type AppRoute = PublicRoute | ClientRoute | StaffRoute;

export const APP_ROUTES = {
  root: "/" satisfies PublicRoute,
  login: "/login" satisfies PublicRoute,
  portal: "/portal" satisfies ClientRoute,
  staff: {
    dashboard: "/dashboard",
    sales: "/sales",
    clients: "/clients",
    applications: "/applications",
    documents: "/documents",
    visa: "/visa",
    whatsapp: "/whatsapp",
    calls: "/calls",
    notifications: "/notifications",
    tasks: "/tasks",
    chat: "/chat",
    reports: "/reports",
    finance: "/finance",
    settings: "/settings",
  } satisfies Record<string, StaffRoute>,
} as const;

export const ROLE_HOME_ROUTE = {
  admin: APP_ROUTES.staff.sales,
  sales: APP_ROUTES.staff.sales,
  admissions: APP_ROUTES.staff.clients,
  client: APP_ROUTES.portal,
} satisfies Record<Role, StaffRoute | ClientRoute>;

export type StaffNavItem = {
  readonly href: StaffRoute;
  readonly labelKey: string;
  readonly allowedRoles: readonly StaffRole[];
};

export const STAFF_NAV_ITEMS = [
  {
    href: APP_ROUTES.staff.dashboard,
    labelKey: "dashboard",
    allowedRoles: STAFF_ROLES,
  },
  {
    href: APP_ROUTES.staff.sales,
    labelKey: "sales",
    allowedRoles: ["admin", "sales"],
  },
  {
    href: APP_ROUTES.staff.clients,
    labelKey: "clients",
    allowedRoles: ["admin", "admissions"],
  },
  {
    href: APP_ROUTES.staff.applications,
    labelKey: "applications",
    allowedRoles: ["admin", "admissions"],
  },
  {
    href: APP_ROUTES.staff.documents,
    labelKey: "documents",
    allowedRoles: ["admin", "admissions"],
  },
  {
    href: APP_ROUTES.staff.visa,
    labelKey: "visa",
    allowedRoles: ["admin", "admissions"],
  },
  {
    href: APP_ROUTES.staff.whatsapp,
    labelKey: "whatsapp",
    allowedRoles: STAFF_ROLES,
  },
  {
    href: APP_ROUTES.staff.calls,
    labelKey: "calls",
    allowedRoles: ["admin", "sales"],
  },
  {
    href: APP_ROUTES.staff.notifications,
    labelKey: "notifications",
    allowedRoles: STAFF_ROLES,
  },
  {
    href: APP_ROUTES.staff.tasks,
    labelKey: "tasks",
    allowedRoles: ["admin", "admissions"],
  },
  {
    href: APP_ROUTES.staff.chat,
    labelKey: "chat",
    allowedRoles: STAFF_ROLES,
  },
  {
    href: APP_ROUTES.staff.reports,
    labelKey: "reports",
    allowedRoles: STAFF_ROLES,
  },
  {
    href: APP_ROUTES.staff.finance,
    labelKey: "finance",
    allowedRoles: ["admin", "admissions"],
  },
  {
    href: APP_ROUTES.staff.settings,
    labelKey: "settings",
    allowedRoles: ["admin"],
  },
] as const satisfies readonly StaffNavItem[];

export function isStaffRole(role: Role): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

export function roleCanAccessStaffRoute(role: Role, route: StaffRoute): boolean {
  if (!isStaffRole(role)) return false;
  return STAFF_NAV_ITEMS.some(
    (item) => item.href === route && (item.allowedRoles as readonly StaffRole[]).includes(role),
  );
}

export const CLIENT_STAGES = [
  "lead",
  "consultation",
  "contract",
  "documents",
  "applying",
  "offer",
  "visa",
  "enrolled",
  "archived",
] as const;
export type ClientStage = (typeof CLIENT_STAGES)[number];

export const APPLICATION_STATUSES = ["preparing", "submitted", "offer", "rejected", "enrolled"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const DOCUMENT_STATUSES = ["required", "uploaded", "review", "approved", "rejected"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const VISA_STATUSES = ["not_started", "docs", "appointment", "submitted", "approved", "rejected"] as const;
export type VisaStatus = (typeof VISA_STATUSES)[number];

export const PAYMENT_STATUSES = ["pending", "paid", "overdue"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TASK_STATUSES = ["todo", "in_progress", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const MESSAGE_DIRECTIONS = ["in", "out"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const CALL_DIRECTIONS = ["in", "out"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_STATUSES = ["answered", "missed", "busy"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export type EntityId = number;
export type CurrencyCode = "KGS" | "USD" | "EUR" | string;
export type IsoDateString = string;
export type DateTimeString = string;

export type UserIdentity = {
  readonly id: EntityId;
  readonly email: string;
  readonly phone: string | null;
  readonly name: string;
  readonly role: Role;
  readonly createdAt: DateTimeString;
};

export type StaffUser = UserIdentity & {
  readonly role: StaffRole;
};

export type ClientUser = UserIdentity & {
  readonly role: "client";
};

export type Lead = {
  readonly id: EntityId;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly source: string | null;
  readonly status: LeadStatus;
  readonly amount: number | null;
  readonly currency: CurrencyCode;
  readonly managerId: EntityId | null;
  readonly clientId: EntityId | null;
  readonly targetCountry: string | null;
  readonly notes: string | null;
  readonly createdAt: DateTimeString;
  readonly updatedAt: DateTimeString;
};

export type ClientProfile = {
  readonly id: EntityId;
  readonly userId: EntityId;
  readonly stage: ClientStage;
  readonly managerId: EntityId | null;
  readonly curatorId: EntityId | null;
  readonly source: string | null;
  readonly targetCountry: string | null;
  readonly targetDegree: string | null;
  readonly notes: string | null;
  readonly createdAt: DateTimeString;
};

export type UniversityApplication = {
  readonly id: EntityId;
  readonly clientId: EntityId;
  readonly university: string;
  readonly country: string | null;
  readonly program: string | null;
  readonly degree: string | null;
  readonly deadline: IsoDateString | null;
  readonly status: ApplicationStatus;
  readonly notes: string | null;
  readonly updatedAt: DateTimeString;
};

export type StudentDocument = {
  readonly id: EntityId;
  readonly clientId: EntityId;
  readonly name: string;
  readonly status: DocumentStatus;
  readonly comment: string | null;
  readonly updatedAt: DateTimeString;
};

export type VisaCase = {
  readonly id: EntityId;
  readonly clientId: EntityId;
  readonly country: string;
  readonly status: VisaStatus;
  readonly appointmentAt: DateTimeString | null;
  readonly notes: string | null;
  readonly updatedAt: DateTimeString;
};

export type Payment = {
  readonly id: EntityId;
  readonly clientId: EntityId;
  readonly title: string;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly dueDate: IsoDateString | null;
  readonly paidAt: IsoDateString | null;
  readonly status: PaymentStatus;
  readonly createdAt: DateTimeString;
};

export type Task = {
  readonly id: EntityId;
  readonly title: string;
  readonly description: string | null;
  readonly clientId: EntityId | null;
  readonly assigneeId: EntityId | null;
  readonly dueDate: IsoDateString | null;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly createdBy: EntityId | null;
  readonly createdAt: DateTimeString;
};

export type WhatsAppConversation = {
  readonly id: EntityId;
  readonly phone: string;
  readonly name: string | null;
  readonly leadId: EntityId | null;
  readonly clientId: EntityId | null;
  readonly lastMessageAt: DateTimeString | null;
  readonly unread: number;
};

export type WhatsAppMessage = {
  readonly id: EntityId;
  readonly conversationId: EntityId;
  readonly direction: MessageDirection;
  readonly text: string;
  readonly status:
    | "sent"
    | "received"
    | "delivered"
    | "read"
    | "failed"
    | "unknown"
    | "prepared"
    | "demo";
  readonly authorId: EntityId | null;
  readonly providerMessageId: string | null;
  readonly createdAt: DateTimeString;
};

export type CallLogEntry = {
  readonly id: EntityId;
  readonly direction: CallDirection;
  readonly phone: string;
  readonly managerId: EntityId | null;
  readonly leadId: EntityId | null;
  readonly clientId: EntityId | null;
  readonly startedAt: DateTimeString;
  readonly durationSec: number;
  readonly status: CallStatus;
  readonly recordingUrl: string | null;
  readonly notes: string | null;
};
