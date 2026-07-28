export type WhatsAppAccessActor = {
  id: number;
  role: string;
};

export type ResolvedWhatsAppClient = {
  id: number;
  manager_id: number | null;
  manager_role: string | null;
  curator_id: number | null;
  curator_role: string | null;
  case_state: string;
};

export type ResolvedWhatsAppLead = {
  id: number;
  manager_id: number | null;
  manager_role: string | null;
  client_id: number | null;
};

export type WhatsAppConversationAccessSubject = {
  conversationClientId: number | null;
  conversationLeadId: number | null;
  resolvedClient: ResolvedWhatsAppClient | null;
  resolvedLead: ResolvedWhatsAppLead | null;
};

export type WhatsAppConversationAccessMode =
  | "none"
  | "admin_full"
  | "sales_full_pre_handoff"
  | "sales_post_handoff_summary"
  | "curator_full";

export type WhatsAppCapability =
  | "read_full"
  | "send"
  | "mark_read"
  | "draft"
  | "read_summary";

const ALL_FULL_CAPABILITIES = [
  "read_full",
  "send",
  "mark_read",
  "draft",
  "read_summary",
] as const satisfies readonly WhatsAppCapability[];

const CAPABILITIES_BY_MODE: Record<
  WhatsAppConversationAccessMode,
  ReadonlySet<WhatsAppCapability>
> = {
  none: new Set(),
  admin_full: new Set(ALL_FULL_CAPABILITIES),
  sales_full_pre_handoff: new Set(ALL_FULL_CAPABILITIES),
  sales_post_handoff_summary: new Set(["read_summary"]),
  curator_full: new Set(ALL_FULL_CAPABILITIES),
};

function isStoredId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isValidActor(actor: WhatsAppAccessActor): boolean {
  return (
    actor !== null
    && typeof actor === "object"
    && isStoredId(actor.id)
    && typeof actor.role === "string"
  );
}

function isValidRawLink(value: unknown): value is number | null {
  return value === null || isStoredId(value);
}

function resolvedRecordMatches<T extends { id: number }>(
  rawId: number,
  record: T | null,
): record is T {
  return record !== null && isStoredId(record.id) && record.id === rawId;
}

function resolveDirectCaseAccess(
  actor: WhatsAppAccessActor,
  client: ResolvedWhatsAppClient,
): WhatsAppConversationAccessMode {
  if (client.case_state === "pending") {
    if (!isStoredId(client.manager_id) || client.manager_role !== "sales") {
      return "none";
    }
    return actor.role === "sales" && actor.id === client.manager_id
      ? "sales_full_pre_handoff"
      : "none";
  }

  if (client.case_state === "active" || client.case_state === "closed") {
    if (!isStoredId(client.curator_id) || client.curator_role !== "curator") {
      return "none";
    }

    if (actor.role === "curator" && actor.id === client.curator_id) {
      return "curator_full";
    }

    if (
      actor.role === "sales"
      && isStoredId(client.manager_id)
      && client.manager_role === "sales"
      && actor.id === client.manager_id
    ) {
      return "sales_post_handoff_summary";
    }
  }

  return "none";
}

function resolveLeadOnlyAccess(
  actor: WhatsAppAccessActor,
  lead: ResolvedWhatsAppLead,
): WhatsAppConversationAccessMode {
  if (
    lead.client_id !== null
    || !isStoredId(lead.manager_id)
    || lead.manager_role !== "sales"
  ) {
    return "none";
  }
  return actor.role === "sales" && actor.id === lead.manager_id
    ? "sales_full_pre_handoff"
    : "none";
}

export function resolveWhatsAppConversationAccess(
  actor: WhatsAppAccessActor,
  subject: WhatsAppConversationAccessSubject,
): WhatsAppConversationAccessMode {
  if (!isValidActor(actor)) return "none";
  if (actor.role === "admin") return "admin_full";
  if (actor.role !== "sales" && actor.role !== "curator") return "none";

  if (
    subject === null
    || typeof subject !== "object"
    || !isValidRawLink(subject.conversationClientId)
    || !isValidRawLink(subject.conversationLeadId)
  ) {
    return "none";
  }

  const clientId = subject.conversationClientId;
  const leadId = subject.conversationLeadId;

  if (clientId !== null) {
    const resolvedClient = subject.resolvedClient;
    if (!resolvedRecordMatches(clientId, resolvedClient)) return "none";

    if (leadId !== null) {
      const resolvedLead = subject.resolvedLead;
      if (!resolvedRecordMatches(leadId, resolvedLead)) return "none";

      const leadClientId = resolvedLead.client_id;
      if (leadClientId !== null && leadClientId !== clientId) return "none";
    }

    return resolveDirectCaseAccess(actor, resolvedClient);
  }

  if (leadId === null) return "none";
  const resolvedLead = subject.resolvedLead;
  if (!resolvedRecordMatches(leadId, resolvedLead)) return "none";

  return resolveLeadOnlyAccess(actor, resolvedLead);
}

export function canWhatsAppCapability(
  mode: WhatsAppConversationAccessMode | string,
  capability: WhatsAppCapability | string,
): boolean {
  const grants = CAPABILITIES_BY_MODE[mode as WhatsAppConversationAccessMode];
  return grants?.has(capability as WhatsAppCapability) ?? false;
}

export function canCreateManualWhatsAppConversation(
  actor: WhatsAppAccessActor,
): boolean {
  return isValidActor(actor) && actor.role === "admin";
}
