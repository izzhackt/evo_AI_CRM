import type { StudentCaseState } from "./student-case-policy";

export type AccessActor = {
  id: number;
  role: string;
};

export type ClientAccessSubject = {
  id: number;
  manager_id: number | null;
  curator_id: number | null;
  case_state: StudentCaseState;
  handoff_at?: string | null;
};

export type ClientAccessMode =
  | "none"
  | "admin_full"
  | "sales_full_pre_handoff"
  | "sales_post_handoff_summary"
  | "curator_full"
  | "finance_projection"
  | "student_portal";

export type ClientCapability =
  | "read_full"
  | "read_summary"
  | "read_finance"
  | "write_profile"
  | "write_applications"
  | "write_documents"
  | "write_visa"
  | "write_tasks"
  | "write_updates"
  | "write_finance"
  | "transition_case"
  | "read_case_audit";

export type SqlPredicate = {
  sql: string;
  params: Array<string | number>;
};

const ALL_CAPABILITIES = [
  "read_full",
  "read_summary",
  "read_finance",
  "write_profile",
  "write_applications",
  "write_documents",
  "write_visa",
  "write_tasks",
  "write_updates",
  "write_finance",
  "transition_case",
  "read_case_audit",
] as const satisfies readonly ClientCapability[];

const CAPABILITIES_BY_MODE: Record<
  ClientAccessMode,
  ReadonlySet<ClientCapability>
> = {
  none: new Set(),
  admin_full: new Set(ALL_CAPABILITIES),
  sales_full_pre_handoff: new Set([
    "read_full",
    "read_summary",
    "write_profile",
    "write_applications",
    "write_documents",
    "write_tasks",
    "write_updates",
  ]),
  sales_post_handoff_summary: new Set(["read_summary"]),
  curator_full: new Set([
    "read_full",
    "read_summary",
    "write_profile",
    "write_applications",
    "write_documents",
    "write_visa",
    "write_tasks",
    "write_updates",
    "transition_case",
    "read_case_audit",
  ]),
  finance_projection: new Set(["read_finance", "write_finance"]),
  student_portal: new Set(),
};

const SAFE_SQL_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validatedAlias(alias: string): string {
  if (!SAFE_SQL_ALIAS.test(alias)) {
    throw new TypeError("Invalid SQL table alias");
  }
  return alias;
}

function denyPredicate(): SqlPredicate {
  return { sql: "0 = 1", params: [] };
}

export function resolveClientAccess(
  actor: AccessActor,
  client: ClientAccessSubject,
): ClientAccessMode {
  if (actor.role === "admin") return "admin_full";
  if (actor.role === "finance") return "finance_projection";

  if (actor.role === "sales" && client.manager_id === actor.id) {
    return client.case_state === "pending"
      ? "sales_full_pre_handoff"
      : "sales_post_handoff_summary";
  }

  if (
    actor.role === "curator"
    && client.curator_id === actor.id
    && (client.case_state === "active" || client.case_state === "closed")
  ) {
    return "curator_full";
  }

  return "none";
}

export function canClientCapability(
  mode: ClientAccessMode | string,
  capability: ClientCapability | string,
): boolean {
  const grants = CAPABILITIES_BY_MODE[mode as ClientAccessMode];
  return grants?.has(capability as ClientCapability) ?? false;
}

export function canMutateClientlessTask(
  actor: AccessActor,
  assigneeId: number | null,
): boolean {
  if (actor.role === "admin") return true;
  return (
    (actor.role === "sales" || actor.role === "finance")
    && assigneeId === actor.id
  );
}

export function canReceiveClientTask(
  assignee: AccessActor,
  client: ClientAccessSubject,
): boolean {
  return canClientCapability(
    resolveClientAccess(assignee, client),
    "write_tasks",
  );
}

export function buildVisibleClientPredicate(
  actor: AccessActor,
  alias = "c",
): SqlPredicate {
  const table = validatedAlias(alias);

  switch (actor.role) {
    case "admin":
    case "finance":
      return { sql: "1 = 1", params: [] };
    case "sales":
      return { sql: `${table}.manager_id = ?`, params: [actor.id] };
    case "curator":
      return {
        sql: `${table}.curator_id = ? AND ${table}.case_state IN ('active', 'closed')`,
        params: [actor.id],
      };
    default:
      return denyPredicate();
  }
}

export function buildFullClientPredicate(
  actor: AccessActor,
  alias = "c",
): SqlPredicate {
  const table = validatedAlias(alias);

  switch (actor.role) {
    case "admin":
      return { sql: "1 = 1", params: [] };
    case "sales":
      return {
        sql: `${table}.manager_id = ? AND ${table}.case_state = 'pending'`,
        params: [actor.id],
      };
    case "curator":
      return {
        sql: `${table}.curator_id = ? AND ${table}.case_state IN ('active', 'closed')`,
        params: [actor.id],
      };
    default:
      return denyPredicate();
  }
}

export function buildVisaClientPredicate(
  actor: AccessActor,
  alias = "c",
): SqlPredicate {
  const table = validatedAlias(alias);

  if (actor.role === "admin") {
    return { sql: "1 = 1", params: [] };
  }
  if (actor.role === "curator") {
    return {
      sql: `${table}.curator_id = ? AND ${table}.case_state IN ('active', 'closed')`,
      params: [actor.id],
    };
  }
  return denyPredicate();
}

export class ObjectAccessDeniedError extends Error {
  readonly code = "OBJECT_ACCESS_DENIED";

  constructor() {
    super("Object not found or access denied");
    this.name = "ObjectAccessDeniedError";
  }
}
