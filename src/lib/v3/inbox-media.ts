import "server-only";

import { randomUUID } from "node:crypto";

import { fixedRoleCan } from "../fixed-role-policy.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import type { PlatformMessageMedia } from "../platform-communications.ts";
import {
  getPlatformCaseDocumentWorkspace,
  type PlatformCaseDocumentWorkspace,
} from "../platform-private-documents.ts";

const MEDIA_ROUTE_PREFIX = "/api/v3/communication-media/";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const SAFE_MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;\s*[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+-]+)*$/iu;
const ATTACHABLE_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

/** Mirrors migration 121's canonical upper bound. The server repeats it. */
export const V3_INBOX_MEDIA_ATTACH_MAX_BYTES = 25 * 1024 * 1024;

export type V3InboxMessageMediaState =
  | "available"
  | "processing"
  | "unavailable"
  | "quarantined";

export type V3InboxMessageMedia = Readonly<{
  /** Opaque route/action identifier. null means the item must fail closed. */
  mediaId: string | null;
  kindLabel: string;
  fileName: string | null;
  mimeType: string | null;
  fileSizeLabel: string | null;
  state: V3InboxMessageMediaState;
  stateLabel: string;
  previewHref: string | null;
  downloadHref: string | null;
  attachable: boolean;
}>;

export type V3InboxMediaAttachmentSlot = Readonly<{
  /** Canonical active document slot id; never rendered as staff-facing text. */
  documentSlotId: string;
  label: string;
  expectedVersion: string;
}>;

export type V3InboxMediaAttachmentContext = Readonly<{
  conversationId: string;
  studentCaseId: string;
  slots: readonly V3InboxMediaAttachmentSlot[];
  requestIdsByMediaId: Readonly<Record<string, string>>;
}>;

export type V3InboxMediaAttachmentDependencies = Readonly<{
  readWorkspace(
    actor: ActivePlatformActor,
    studentCaseId: string,
  ): Promise<PlatformCaseDocumentWorkspace>;
  requestId(): string;
}>;

const defaultAttachmentDependencies: V3InboxMediaAttachmentDependencies = {
  readWorkspace: getPlatformCaseDocumentWorkspace,
  requestId: randomUUID,
};

function mediaKindLabel(kind: PlatformMessageMedia["mediaKind"]): string {
  if (kind === "image") return "Изображение";
  if (kind === "audio") return "Аудио";
  if (kind === "video") return "Видео";
  if (kind === "pdf") return "PDF";
  return "Файл";
}

function safeFileName(value: string | null): string | null | undefined {
  if (value === null) return null;
  if (
    value.length < 1
    || value.length > 255
    || value !== value.trim()
    || CONTROL_CHARACTER_PATTERN.test(value)
    || value.includes("/")
    || value.includes("\\")
  ) {
    return undefined;
  }
  return value;
}

function safeMimeType(value: string | null): string | null | undefined {
  if (value === null) return null;
  return value.length <= 255 && SAFE_MIME_TYPE_PATTERN.test(value)
    ? value
    : undefined;
}

function safeFileSize(value: number | null): number | null | undefined {
  if (value === null) return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function formatFileSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function unavailableMedia(kindLabel: string): V3InboxMessageMedia {
  return Object.freeze({
    mediaId: null,
    kindLabel,
    fileName: null,
    mimeType: null,
    fileSizeLabel: null,
    state: "unavailable" as const,
    stateLabel: "Вложение недоступно: метаданные не прошли проверку.",
    previewHref: null,
    downloadHref: null,
    attachable: false,
  });
}

/**
 * Reduces the canonical read model to the only media facts the Inbox browser
 * needs. Storage coordinates, provider ids and archival internals never cross
 * this adapter.
 */
export function toV3InboxMessageMedia(
  media: PlatformMessageMedia,
): V3InboxMessageMedia {
  const kindLabel = mediaKindLabel(media.mediaKind);
  const mediaId = UUID_PATTERN.test(media.id) ? media.id : null;
  const fileName = safeFileName(media.fileName);
  const mimeType = safeMimeType(media.mimeType);
  const fileSizeBytes = safeFileSize(media.fileSizeBytes);
  if (
    mediaId === null
    || fileName === undefined
    || mimeType === undefined
    || fileSizeBytes === undefined
  ) {
    return unavailableMedia(kindLabel);
  }

  const href = `${MEDIA_ROUTE_PREFIX}${mediaId}`;
  const available = media.archivalStatus === "archived";
  const attachable = available
    && fileName !== null
    && mimeType !== null
    && ATTACHABLE_MIME_TYPES.has(mimeType)
    && fileSizeBytes !== null
    && fileSizeBytes >= 1
    && fileSizeBytes <= V3_INBOX_MEDIA_ATTACH_MAX_BYTES;

  if (available) {
    return Object.freeze({
      mediaId,
      kindLabel,
      fileName,
      mimeType,
      fileSizeLabel: formatFileSize(fileSizeBytes),
      state: "available" as const,
      stateLabel: "Вложение готово.",
      previewHref: href,
      downloadHref: `${href}?download=1`,
      attachable,
    });
  }

  const processing = media.archivalStatus === "pending"
    || media.archivalStatus === "processing";
  const quarantined = media.archivalStatus === "terminal_error";
  return Object.freeze({
    mediaId,
    kindLabel,
    fileName,
    mimeType,
    fileSizeLabel: formatFileSize(fileSizeBytes),
    state: processing
      ? "processing" as const
      : quarantined
        ? "quarantined" as const
        : "unavailable" as const,
    stateLabel: processing
      ? "Вложение обрабатывается."
      : quarantined
        ? "Вложение недоступно: отклонено проверкой или помещено в карантин."
        : "Вложение временно недоступно.",
    previewHref: null,
    downloadHref: null,
    attachable: false,
  });
}

function attachmentRoleAllowed(actor: ActivePlatformActor): boolean {
  return fixedRoleCan(actor.presentationRole, "documents.write")
    && fixedRoleCan(actor.presentationRole, "messaging.read")
    && fixedRoleCan(actor.authorityRole, "documents.write")
    && fixedRoleCan(actor.authorityRole, "messaging.read");
}

/**
 * Loads document slots only after both presentation and immutable authority
 * roles pass. Sales and Admin-preview-as-Sales therefore cannot trigger the
 * document reader at all.
 */
export async function readV3InboxMediaAttachmentContext(
  actor: ActivePlatformActor,
  input: Readonly<{
    conversationId: string;
    studentCaseId: string | null;
    media: readonly V3InboxMessageMedia[];
  }>,
  dependencies: V3InboxMediaAttachmentDependencies = defaultAttachmentDependencies,
): Promise<V3InboxMediaAttachmentContext | null> {
  if (
    !attachmentRoleAllowed(actor)
    || input.studentCaseId === null
    || !UUID_PATTERN.test(input.conversationId)
    || !UUID_PATTERN.test(input.studentCaseId)
  ) {
    return null;
  }

  const mediaIds = [...new Set(
    input.media.flatMap((item) =>
      item.attachable && item.mediaId !== null ? [item.mediaId] : []),
  )];
  if (mediaIds.length === 0) return null;

  let workspace: PlatformCaseDocumentWorkspace;
  try {
    workspace = await dependencies.readWorkspace(actor, input.studentCaseId);
  } catch {
    return null;
  }
  if (
    workspace.studentCaseId !== input.studentCaseId
    || workspace.organizationId !== actor.organizationId
    || workspace.caseState !== "active"
  ) {
    return null;
  }

  const slots = workspace.slots
    .filter((slot) => slot.status !== "approved")
    .map((slot) => Object.freeze({
      documentSlotId: slot.documentSlotId,
      label: `${slot.groupLabel} · ${slot.requirementLabel}`,
      expectedVersion: String(slot.version),
    }));
  if (slots.length === 0) return null;

  const requestIdsByMediaId: Record<string, string> = {};
  for (const mediaId of mediaIds) {
    const requestId = dependencies.requestId();
    if (!UUID_PATTERN.test(requestId)) return null;
    requestIdsByMediaId[mediaId] = requestId;
  }

  return Object.freeze({
    conversationId: input.conversationId,
    studentCaseId: input.studentCaseId,
    slots: Object.freeze(slots),
    requestIdsByMediaId: Object.freeze(requestIdsByMediaId),
  });
}
