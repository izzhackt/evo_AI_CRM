"use server";

import { revalidatePath } from "next/cache";

import {
  isPlatformDocumentIntakeError,
  reservePlatformDocumentUpload,
  type PlatformDocumentIntakeErrorCode,
  type PlatformDocumentUploadMetadata,
  type PlatformDocumentUploadReservation,
} from "./platform-document-intake";
import { resolvePlatformActor } from "./platform-auth";
import {
  createPlatformDocumentSignedDownload,
  finalizeAndQueuePlatformDocumentUpload,
  type PlatformDocumentFinalizedIntake,
  type PlatformDocumentSignedDownload,
} from "./server/platform-document-intake-repository";
import { createPlatformServiceSupabaseClient } from "./server/platform-service-supabase";
import { createSupabaseServerContext } from "./supabase/server";

type ActionFailureCode =
  | PlatformDocumentIntakeErrorCode
  | "unauthenticated"
  | "authority_invalid";

export type PlatformDocumentActionResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: ActionFailureCode; retryable: boolean }>;

type FinalizeInput = Readonly<{
  metadata: PlatformDocumentUploadMetadata;
  uploadReservationId: string;
  finalizeRequestId: string;
  enqueueRequestId: string;
}>;

type DownloadInput = Readonly<{
  organizationId: string;
  documentVersionId: string;
  accessPurpose: string;
  grantRequestId: string;
  consumeRequestId: string;
}>;

async function actorContext(): Promise<
  | Readonly<{
      ok: true;
      client: Awaited<ReturnType<typeof createSupabaseServerContext>>["client"];
      organizationId: string;
    }>
  | Readonly<{
      ok: false;
      code: "unauthenticated" | "authority_invalid";
    }>
> {
  const context = await createSupabaseServerContext();
  const actor = await resolvePlatformActor(
    context.client,
    context.authCookiePresent,
  );
  if (actor.status === "anonymous") {
    return { ok: false, code: "unauthenticated" };
  }
  if (actor.status === "invalid") {
    return { ok: false, code: "authority_invalid" };
  }
  return {
    ok: true,
    client: context.client,
    organizationId: actor.actor.organizationId,
  };
}

function failure(error: unknown): PlatformDocumentActionResult<never> {
  if (isPlatformDocumentIntakeError(error)) {
    return { ok: false, code: error.code, retryable: error.retryable };
  }
  return { ok: false, code: "unavailable", retryable: true };
}

function matchesActorOrganization(
  value: unknown,
  organizationId: string,
): boolean {
  return typeof value === "string" && value.toLowerCase() === organizationId;
}

export async function reservePlatformDocumentUploadAction(
  metadata: PlatformDocumentUploadMetadata,
): Promise<PlatformDocumentActionResult<PlatformDocumentUploadReservation>> {
  try {
    const context = await actorContext();
    if (!context.ok) {
      return { ok: false, code: context.code, retryable: false };
    }
    if (!matchesActorOrganization(metadata?.organizationId, context.organizationId)) {
      return { ok: false, code: "forbidden", retryable: false };
    }
    return {
      ok: true,
      value: await reservePlatformDocumentUpload(context.client, metadata),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function finalizePlatformDocumentUploadAction(
  input: FinalizeInput,
): Promise<PlatformDocumentActionResult<PlatformDocumentFinalizedIntake>> {
  try {
    const context = await actorContext();
    if (!context.ok) {
      return { ok: false, code: context.code, retryable: false };
    }
    if (
      !matchesActorOrganization(
        input?.metadata?.organizationId,
        context.organizationId,
      )
    ) {
      return { ok: false, code: "forbidden", retryable: false };
    }
    const serviceClient = await createPlatformServiceSupabaseClient();
    const value = await finalizeAndQueuePlatformDocumentUpload({
      userClient: context.client,
      serviceClient,
      metadata: input.metadata,
      uploadReservationId: input.uploadReservationId,
      finalizeRequestId: input.finalizeRequestId,
      enqueueRequestId: input.enqueueRequestId,
    });
    revalidatePath("/documents");
    revalidatePath("/portal/documents");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

export async function createPlatformDocumentDownloadAction(
  input: DownloadInput,
): Promise<PlatformDocumentActionResult<PlatformDocumentSignedDownload>> {
  try {
    const context = await actorContext();
    if (!context.ok) {
      return { ok: false, code: context.code, retryable: false };
    }
    if (!matchesActorOrganization(input?.organizationId, context.organizationId)) {
      return { ok: false, code: "forbidden", retryable: false };
    }
    return {
      ok: true,
      value: await createPlatformDocumentSignedDownload({
        userClient: context.client,
        serviceClient: await createPlatformServiceSupabaseClient(),
        organizationId: input.organizationId,
        documentVersionId: input.documentVersionId,
        accessPurpose: input.accessPurpose,
        grantRequestId: input.grantRequestId,
        consumeRequestId: input.consumeRequestId,
      }),
    };
  } catch (error) {
    return failure(error);
  }
}
