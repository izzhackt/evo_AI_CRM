// Чистая модель экрана «Документы»: проверка выбранного файла, подписи статусов,
// полоса чек-листа. Порт чистых частей src/components/portal/admission/presentation.ts
// и PortalDocumentControls.tsx (веб); без React и без нативных модулей.
import type { PortalStrings } from "@web/lib/portal/i18n";

import { DOCUMENT_MIME_TYPES, type DocumentMimeType, type StudentPortalDocument } from "@/domain/portal-source";

type AdmissionStrings = PortalStrings<"admission">;

/** Лимит маршрута загрузки (`MAX_FILE_BYTES` веба): 25 МБ. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type PickSource = "file" | "photo" | "camera";

export type PickedFile = Readonly<{
  uri: string;
  name: string;
  /** Размер в байтах: его определяет слой выбора (File.size), а не ответ пикера. */
  size: number;
  mimeType: string | null;
  source: PickSource;
}>;

const EXTENSION_TYPES: Readonly<Record<string, DocumentMimeType>> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** Тип файла для загрузки или `null`, если он не PDF/JPEG/PNG (HEIC, GIF, WebP и прочее). */
export function resolveMimeType(file: Pick<PickedFile, "name" | "mimeType">): DocumentMimeType | null {
  const declared = file.mimeType?.toLowerCase().split(";")[0]?.trim() ?? "";
  const normalized = declared === "image/jpg" || declared === "image/pjpeg" ? "image/jpeg" : declared;
  if ((DOCUMENT_MIME_TYPES as readonly string[]).includes(normalized)) return normalized as DocumentMimeType;
  // Тип не назван или общий: смотрим на расширение. Названный чужой тип (image/heic) не перекрывается.
  if (normalized === "" || normalized === "application/octet-stream") {
    const extension = file.name.toLowerCase().split(".").pop() ?? "";
    return EXTENSION_TYPES[extension] ?? null;
  }
  return null;
}

export type FileCheck = Readonly<{ ok: true; mimeType: DocumentMimeType }> | Readonly<{ ok: false; reason: "type" | "size" | "empty" }>;

/** Проверка до отправки: тот же набор, что принимает сервер (PDF/JPEG/PNG, 1 байт..25 МБ). */
export function checkPickedFile(file: PickedFile): FileCheck {
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, reason: "size" };
  const mimeType = resolveMimeType(file);
  return mimeType ? { ok: true, mimeType } : { ok: false, reason: "type" };
}

/** Имя для локального файла: без путей и служебных знаков, с расширением по типу. */
export function safeFileName(name: string | null | undefined, mimeType: string | null | undefined): string {
  const cleaned = (name ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  const base = cleaned.length > 0 ? cleaned : "document";
  const wanted = mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : null;
  if (!wanted) return base;
  const extension = base.toLowerCase().split(".").pop() ?? "";
  const alreadyRight = base.includes(".") && (EXTENSION_TYPES[extension] ?? null) === mimeType;
  return alreadyRight ? base : `${base}.${wanted}`;
}

// ---- чек-лист ----------------------------------------------------------------

export type PortalTone = "neutral" | "info" | "ok" | "warn" | "danger";

export function documentStatusTone(status: StudentPortalDocument["status"]): PortalTone {
  switch (status) {
    case "approved":
      return "ok";
    case "correction_required":
      return "warn";
    case "rejected":
      return "danger";
    case "submitted":
      return "info";
    default:
      return "neutral";
  }
}

export type ChecklistIcon = "file" | "clock" | "check" | "alert";

export function documentChecklistIcon(status: StudentPortalDocument["status"]): ChecklistIcon {
  return status === "correction_required" || status === "rejected" ? "alert" : status === "submitted" ? "clock" : status === "approved" ? "check" : "file";
}

export function documentStatusLabel(status: StudentPortalDocument["status"], strings: AdmissionStrings): string {
  return strings[`docStatus.${status}`] ?? strings.statusUnavailable;
}

/** Решение EVO словом; не повторяет плашку статуса («Нужно исправить» дважды не пишем). */
export function documentReviewText(document: StudentPortalDocument, strings: AdmissionStrings): string | null {
  if (document.reviewDecision === null) return null;
  const label = strings[`reviewDecision.${document.reviewDecision}`] ?? null;
  if (label === null) return null;
  return label.toLocaleLowerCase() === documentStatusLabel(document.status, strings).toLocaleLowerCase() ? null : label;
}

export type ChecklistCount = Readonly<{ kind: "approved" | "submitted" | "correction" | "required"; label: string; count: number }>;

export function documentProgress(documents: readonly Pick<StudentPortalDocument, "status">[]) {
  return {
    approved: documents.filter((d) => d.status === "approved").length,
    inReview: documents.filter((d) => d.status === "submitted").length,
    corrections: documents.filter((d) => d.status === "correction_required" || d.status === "rejected").length,
    missing: documents.filter((d) => d.status === "required").length,
  };
}

/** Подписи полосы «Чеклист»: принято, на проверке, исправить, не загружено; нулевые опускаются. */
export function documentProgressCounts(documents: readonly Pick<StudentPortalDocument, "status">[], strings: AdmissionStrings): readonly ChecklistCount[] {
  const progress = documentProgress(documents);
  const all: readonly ChecklistCount[] = [
    { kind: "approved", label: strings.acceptedLabel, count: progress.approved },
    { kind: "submitted", label: strings["docStatus.submitted"], count: progress.inReview },
    { kind: "correction", label: strings["docStatus.correction_required"], count: progress.corrections },
    { kind: "required", label: strings["docStatus.required"], count: progress.missing },
  ];
  return all.filter((item) => item.count > 0);
}
