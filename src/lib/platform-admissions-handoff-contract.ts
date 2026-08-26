export const PLATFORM_ADMISSIONS_HANDOFF_MODES = [
  "normal",
  "exceptional_override",
] as const;

export const PLATFORM_ADMISSIONS_HANDOFF_STATUSES = [
  "blocked",
  "ready",
  "completed",
] as const;

export type PlatformAdmissionsHandoffMode =
  (typeof PLATFORM_ADMISSIONS_HANDOFF_MODES)[number];
export type PlatformAdmissionsHandoffStatus =
  (typeof PLATFORM_ADMISSIONS_HANDOFF_STATUSES)[number];

export type PlatformAdmissionsHandoffOwnerOption = Readonly<{
  membershipId: string;
  displayName: string;
}>;

export type PlatformAdmissionsHandoffStarterTask = Readonly<{
  taskId: string;
  sourceKey: string;
  title: string;
  assigneeMembershipId: string;
  assigneeDisplayName: string;
  priority: string;
  dueAt: string | null;
  status: string;
}>;

export type PlatformAdmissionsHandoffInheritedContext = Readonly<{
  actorMembershipId: string;
  actorDisplayName: string;
  workflowVersion: number;
  sales: Readonly<{
    stageKey: string;
    sourceKey: string;
    responsibleSalesMembershipId: string;
    nextAction: string | null;
    nextActionDueDate: string | null;
  }>;
  client: Readonly<{
    clientId: string;
    displayName: string;
  }>;
  provenance: readonly Readonly<{
    provenanceId: string;
    subjectType: "lead" | "client";
    sourceSystem: string;
    evidenceType: string;
    observedAt: string;
    importedAt: string | null;
    sourceReference: string | null;
  }>[];
  conversations: readonly Readonly<{
    conversationId: string;
    subject: string;
    queue: string;
    status: string;
    updatedAt: string;
  }>[];
}>;

export type PlatformAdmissionsHandoff = Readonly<{
  organizationId: string;
  leadId: string;
  gateVersion: number;
  gateState: "blocked" | "satisfied" | "overridden";
  normalHandoffAllowed: boolean;
  exceptionalHandoffAllowed: boolean;
  canSubmitNormal: boolean;
  canSubmitExceptional: boolean;
  status: PlatformAdmissionsHandoffStatus;
  caseId: string | null;
  caseState: "active" | "closed" | null;
  admissionsOwnerMembershipId: string | null;
  admissionsOwnerDisplayName: string | null;
  handoffMode: PlatformAdmissionsHandoffMode | null;
  handoffReason: string | null;
  handedOffAt: string | null;
  starterTaskCount: number;
  starterTasks: readonly PlatformAdmissionsHandoffStarterTask[];
  inheritedContext: PlatformAdmissionsHandoffInheritedContext | null;
  eligibleAdmissionsOwners: readonly PlatformAdmissionsHandoffOwnerOption[];
}>;

export type PlatformAdmissionsHandoffMutationInput = Readonly<{
  leadId: string;
  expectedGateVersion: number;
  admissionsOwnerMembershipId: string;
  handoffMode: PlatformAdmissionsHandoffMode;
  reason: string;
  requestId: string;
}>;

export type PlatformAdmissionsHandoffMutationReceipt = PlatformAdmissionsHandoff &
  Readonly<{
    requestId: string;
    changedAt: string;
  }>;
