"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parsePlatformRouteUuid } from "./platform-communications";
import { requirePlatformMessagingActor } from "./platform-guards";
import {
  normalizePlatformAmoCrmSelectedBindings,
  approvePlatformAmoCrmMappingSelection,
  readPlatformAmoCrmMappingApprovalWorkspace,
  revokePlatformAmoCrmMappingSelection,
  type PlatformAmoCrmSelectedBindings,
} from "./server/platform-amocrm-mapping-repository";
import { createSupabaseServerClient } from "./supabase/server";

const PROVIDER_ID_PATTERN = /^[1-9][0-9]*$/;
const MAX_POSTGRES_BIGINT = "9223372036854775807";
const BINDING_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_REASON_LENGTH = 1_000;
const MAX_BINDINGS_PER_ENTITY = 100;

type ParsedApproveForm = Readonly<{
  conversationId: string;
  discoveryVersionId: string;
  expectedPriorEventId: string | null;
  selectedBindings: PlatformAmoCrmSelectedBindings;
  reason: string;
  requestId: string;
}>;

type ParsedRevokeForm = Readonly<{
  conversationId: string;
  expectedPriorEventId: string;
  reason: string;
  requestId: string;
}>;

function scalar(form: FormData, key: string): string | null {
  const values = form.getAll(key);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  return values[0].trim();
}

function requiredUuid(form: FormData, key: string): string | null {
  return parsePlatformRouteUuid(scalar(form, key));
}

function optionalUuid(form: FormData, key: string): string | null | undefined {
  const candidate = scalar(form, key);
  if (candidate === null) return undefined;
  if (candidate === "") return null;
  return parsePlatformRouteUuid(candidate) ?? undefined;
}

function providerId(value: string | null): string | null {
  if (value === null || !PROVIDER_ID_PATTERN.test(value)) return null;
  if (
    value.length > MAX_POSTGRES_BIGINT.length ||
    (value.length === MAX_POSTGRES_BIGINT.length && value > MAX_POSTGRES_BIGINT)
  ) {
    return null;
  }
  return value;
}

function reason(form: FormData): string | null {
  const candidate = scalar(form, "reason");
  if (
    candidate === null ||
    candidate.length < 1 ||
    candidate.length > MAX_REASON_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function bindings(
  form: FormData,
  entity: "lead" | "contact",
): readonly Readonly<{ bindingKey: string; fieldId: string }>[] | null {
  const rawKeys = form.getAll(`${entity}_binding_key`);
  const rawFieldIds = form.getAll(`${entity}_field_id`);
  if (
    rawKeys.length !== rawFieldIds.length ||
    rawKeys.length < 1 ||
    rawKeys.length > MAX_BINDINGS_PER_ENTITY
  ) {
    return null;
  }
  const result: Array<Readonly<{ bindingKey: string; fieldId: string }>> = [];
  for (let index = 0; index < rawKeys.length; index += 1) {
    const rawKey = rawKeys[index];
    const rawFieldId = rawFieldIds[index];
    if (
      typeof rawKey !== "string" ||
      typeof rawFieldId !== "string"
    ) {
      return null;
    }
    const bindingKey = rawKey.trim();
    const fieldId = providerId(rawFieldId.trim());
    if (!BINDING_KEY_PATTERN.test(bindingKey) || fieldId === null) return null;
    result.push({ bindingKey, fieldId });
  }
  return result;
}

function parsePlatformAmoCrmApproveForm(
  form: FormData,
): ParsedApproveForm | null {
  const conversationId = requiredUuid(form, "conversation_id");
  const discoveryVersionId = requiredUuid(form, "discovery_version_id");
  const expectedPriorEventId = optionalUuid(form, "expected_prior_event_id");
  const pipelineId = providerId(scalar(form, "pipeline_id"));
  const signedContractStatusId = providerId(
    scalar(form, "signed_contract_status_id"),
  );
  const responsibleUserSource = scalar(form, "responsible_user_source");
  const leadCustomFields = bindings(form, "lead");
  const contactCustomFields = bindings(form, "contact");
  const mutationReason = reason(form);
  const requestId = requiredUuid(form, "request_id");
  if (
    conversationId === null ||
    discoveryVersionId === null ||
    expectedPriorEventId === undefined ||
    pipelineId === null ||
    signedContractStatusId === null ||
    responsibleUserSource !== "lead.responsible_user_id" ||
    leadCustomFields === null ||
    contactCustomFields === null ||
    mutationReason === null ||
    requestId === null
  ) {
    return null;
  }
  try {
    const selectedBindings = normalizePlatformAmoCrmSelectedBindings({
      pipeline_id: pipelineId,
      signed_contract_status_id: signedContractStatusId,
      responsible_user_source: responsibleUserSource,
      lead_custom_fields: leadCustomFields.map((binding) => ({
        binding_key: binding.bindingKey,
        field_id: binding.fieldId,
      })),
      contact_custom_fields: contactCustomFields.map((binding) => ({
        binding_key: binding.bindingKey,
        field_id: binding.fieldId,
      })),
    });
    return {
      conversationId,
      discoveryVersionId,
      expectedPriorEventId,
      selectedBindings,
      reason: mutationReason,
      requestId,
    };
  } catch {
    return null;
  }
}

function parsePlatformAmoCrmRevokeForm(
  form: FormData,
): ParsedRevokeForm | null {
  const conversationId = requiredUuid(form, "conversation_id");
  const expectedPriorEventId = requiredUuid(form, "expected_prior_event_id");
  const mutationReason = reason(form);
  const requestId = requiredUuid(form, "request_id");
  if (
    conversationId === null ||
    expectedPriorEventId === null ||
    mutationReason === null ||
    requestId === null
  ) {
    return null;
  }
  return {
    conversationId,
    expectedPriorEventId,
    reason: mutationReason,
    requestId,
  };
}

function selectionBelongsToDiscovery(
  selected: PlatformAmoCrmSelectedBindings,
  workspace: Awaited<ReturnType<typeof readPlatformAmoCrmMappingApprovalWorkspace>>,
): boolean {
  const snapshot = workspace.reviewDiscovery?.sanitizedSnapshot;
  if (!snapshot) return false;
  const pipeline = snapshot.pipelines.find(
    (candidate) => candidate.id === selected.pipelineId,
  );
  if (
    !pipeline ||
    !pipeline.statuses.some(
      (status) => status.id === selected.signedContractStatusId,
    )
  ) {
    return false;
  }
  const leadFieldIds = new Set(
    snapshot.lead_custom_fields.map((field) => field.id),
  );
  const contactFieldIds = new Set(
    snapshot.contact_custom_fields.map((field) => field.id),
  );
  return (
    selected.leadCustomFields.every((binding) =>
      leadFieldIds.has(binding.fieldId)
    ) &&
    selected.contactCustomFields.every((binding) =>
      contactFieldIds.has(binding.fieldId)
    )
  );
}

function mappingRedirect(
  conversationId: string | null,
): never {
  const target = conversationId ? `/whatsapp/${conversationId}` : "/whatsapp";
  redirect(target);
}

function revalidateConversationPath(conversationId: string): void {
  try {
    revalidatePath(`/whatsapp/${conversationId}`);
  } catch {
    // Unit/static consumers may not have a Next request cache. The mutation is
    // already committed; the same-origin redirect still refreshes the route.
  }
}

export async function approvePlatformAmoCrmMappingAction(
  form: FormData,
): Promise<never> {
  const actor = await requirePlatformMessagingActor();
  const parsed = parsePlatformAmoCrmApproveForm(form);
  const fallbackConversationId = requiredUuid(form, "conversation_id");
  if (actor.platformRole !== "admin" || parsed === null) {
    mappingRedirect(fallbackConversationId);
  }
  const client = await createSupabaseServerClient().catch(() => null);
  if (client === null) {
    mappingRedirect(parsed.conversationId);
  }
  const workspace = await readPlatformAmoCrmMappingApprovalWorkspace(client, {
    organizationId: actor.organizationId,
    conversationId: parsed.conversationId,
    discoveryVersionId: parsed.discoveryVersionId,
  }).catch(() => null);
  if (workspace === null) {
    mappingRedirect(parsed.conversationId);
  }
  if (
    workspace.reviewDiscovery?.discoveryVersionId !== parsed.discoveryVersionId ||
    workspace.latestDecision?.eventId !== parsed.expectedPriorEventId ||
    !selectionBelongsToDiscovery(parsed.selectedBindings, workspace)
  ) {
    mappingRedirect(parsed.conversationId);
  }
  const receipt = await approvePlatformAmoCrmMappingSelection(client, {
      organizationId: actor.organizationId,
      conversationId: parsed.conversationId,
      amocrmAccountId: workspace.amocrmAccountId,
      discoveryVersionId: parsed.discoveryVersionId,
      selectedBindings: parsed.selectedBindings,
      expectedPriorEventId: parsed.expectedPriorEventId,
      reason: parsed.reason,
      requestId: parsed.requestId,
    }).catch(() => null);
  if (receipt?.mappingState !== "approved_configured_unverified") {
    mappingRedirect(parsed.conversationId);
  }
  revalidateConversationPath(parsed.conversationId);
  mappingRedirect(parsed.conversationId);
}

export async function revokePlatformAmoCrmMappingAction(
  form: FormData,
): Promise<never> {
  const actor = await requirePlatformMessagingActor();
  const parsed = parsePlatformAmoCrmRevokeForm(form);
  const fallbackConversationId = requiredUuid(form, "conversation_id");
  if (actor.platformRole !== "admin" || parsed === null) {
    mappingRedirect(fallbackConversationId);
  }
  const client = await createSupabaseServerClient().catch(() => null);
  if (client === null) {
    mappingRedirect(parsed.conversationId);
  }
  const workspace = await readPlatformAmoCrmMappingApprovalWorkspace(client, {
    organizationId: actor.organizationId,
    conversationId: parsed.conversationId,
  }).catch(() => null);
  if (workspace === null) {
    mappingRedirect(parsed.conversationId);
  }
  if (
    workspace.mappingState !== "approved_configured_unverified" ||
    workspace.latestDecision?.eventKind !== "approved" ||
    workspace.latestDecision.eventId !== parsed.expectedPriorEventId
  ) {
    mappingRedirect(parsed.conversationId);
  }
  const receipt = await revokePlatformAmoCrmMappingSelection(client, {
      organizationId: actor.organizationId,
      conversationId: parsed.conversationId,
      amocrmAccountId: workspace.amocrmAccountId,
      expectedPriorEventId: parsed.expectedPriorEventId,
      reason: parsed.reason,
      requestId: parsed.requestId,
    }).catch(() => null);
  if (receipt?.mappingState !== "not_approved") {
    mappingRedirect(parsed.conversationId);
  }
  revalidateConversationPath(parsed.conversationId);
  mappingRedirect(parsed.conversationId);
}
